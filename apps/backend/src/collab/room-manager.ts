import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { WS_MESSAGE_AI, WS_MESSAGE_AI_SYNC, WS_MESSAGE_PERF_PROBE, WS_MESSAGE_PRESENCE, WS_MESSAGE_SYNC } from "@collab/shared/collab";

export type SocketLike = {
  send: (data: Uint8Array) => void;
};

export type PersistenceAdapter = {
  loadState: (roomId: string) => Promise<Uint8Array | null>;
  saveState: (roomId: string, state: Uint8Array) => Promise<void>;
};

type Room = {
  id: string;
  doc: Y.Doc;
  clients: Set<SocketLike>;
  /** Lightweight presence state per socket (cursor + user info, not stored in Yjs). */
  socketPresence: Map<SocketLike, { clientId: number; payload: string }>;
  /** Whether the initial DB state has been loaded. */
  loaded: boolean;
  /** Whether the room has been disposed (prevents stale async callbacks). */
  disposed: boolean;
  /** Queue of messages received before the room finished loading. */
  pendingMessages: Array<{ socket: SocketLike; raw: unknown }>;
  /** Handle for the periodic save timer. */
  saveTimer: ReturnType<typeof setInterval> | null;
  /** When true, doc updates are queued instead of broadcast immediately. */
  broadcastPaused: boolean;
  /** Updates collected while broadcasting is paused. */
  pendingUpdates: Uint8Array[];
  dispose: () => void;
};

type ProcessingBucket = "le_1ms" | "le_5ms" | "le_10ms" | "le_25ms" | "le_50ms" | "gt_50ms";

type RoomManagerMetrics = {
  connectionsTotal: number;
  disconnectionsTotal: number;
  messagesTotal: number;
  syncMessagesTotal: number;
  perfProbeMessagesTotal: number;
  invalidMessagesTotal: number;
  bytesInTotal: number;
  bytesOutTotal: number;
  processingBuckets: Record<ProcessingBucket, number>;
};

function toUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

function encodeSyncStep1(doc: Y.Doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

const SAVE_INTERVAL_MS = 30_000;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly persistence: PersistenceAdapter | null;

  /** Called when a WS_MESSAGE_AI is received. Set by the AI handler. */
  onAiMessage:
    | ((roomId: string, socket: SocketLike, doc: Y.Doc, payload: string) => void)
    | null = null;

  private readonly metrics: RoomManagerMetrics = {
    connectionsTotal: 0,
    disconnectionsTotal: 0,
    messagesTotal: 0,
    syncMessagesTotal: 0,
    perfProbeMessagesTotal: 0,
    invalidMessagesTotal: 0,
    bytesInTotal: 0,
    bytesOutTotal: 0,
    processingBuckets: {
      le_1ms: 0,
      le_5ms: 0,
      le_10ms: 0,
      le_25ms: 0,
      le_50ms: 0,
      gt_50ms: 0
    }
  };

  constructor(persistence?: PersistenceAdapter) {
    this.persistence = persistence ?? null;
  }

  private observeOutbound(bytes: number) {
    this.metrics.bytesOutTotal += bytes;
  }

  private observeInbound(bytes: number) {
    this.metrics.bytesInTotal += bytes;
  }

  private observeProcessingDuration(durationMs: number) {
    const buckets = this.metrics.processingBuckets;
    if (durationMs <= 1) buckets.le_1ms += 1;
    else if (durationMs <= 5) buckets.le_5ms += 1;
    else if (durationMs <= 10) buckets.le_10ms += 1;
    else if (durationMs <= 25) buckets.le_25ms += 1;
    else if (durationMs <= 50) buckets.le_50ms += 1;
    else buckets.gt_50ms += 1;
  }

  private async saveRoom(room: Room) {
    if (!this.persistence) return;
    if (!room.loaded || room.disposed) return;
    try {
      const state = Y.encodeStateAsUpdate(room.doc);
      await this.persistence.saveState(room.id, state);
    } catch (error) {
      console.error(`[collab] failed to save room ${room.id}:`, error);
    }
  }

  private getOrCreateRoom(roomId: string): Room {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const doc = new Y.Doc();
    const clients = new Set<SocketLike>();
    const socketPresence = new Map<SocketLike, { clientId: number; payload: string }>();

    // Broadcast doc updates to every client except the one that sent it.
    // When broadcastPaused is true, server-side updates (origin is not a
    // connected client socket) are queued and flushed later. Client-originated
    // updates (origin is a socket) still broadcast immediately.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      const isClientOrigin = origin != null && clients.has(origin as SocketLike);

      if (room.broadcastPaused && !isClientOrigin) {
        room.pendingUpdates.push(update);
        return;
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const payload = encoding.toUint8Array(encoder);

      for (const client of clients) {
        if (client !== origin) {
          this.observeOutbound(payload.byteLength);
          client.send(payload);
        }
      }
    };

    doc.on("update", onUpdate);

    const saveTimer = this.persistence
      ? setInterval(() => {
          this.saveRoom(room);
        }, SAVE_INTERVAL_MS)
      : null;
    if (saveTimer) saveTimer.unref?.();

    const room: Room = {
      id: roomId,
      doc,
      clients,
      socketPresence,
      loaded: !this.persistence,
      disposed: false,
      pendingMessages: [],
      broadcastPaused: false,
      pendingUpdates: [],
      saveTimer,
      dispose: () => {
        room.disposed = true;
        if (saveTimer) clearInterval(saveTimer);
        doc.off("update", onUpdate);
        doc.destroy();
      }
    };

    this.rooms.set(roomId, room);

    if (this.persistence) {
      this.persistence.loadState(roomId).then((state) => {
        if (room.disposed) return;
        if (state && state.length > 0) {
          Y.applyUpdate(doc, state);
        }
        room.loaded = true;
        for (const pending of room.pendingMessages) {
          this.handleMessage(roomId, pending.socket, pending.raw);
        }
        room.pendingMessages.length = 0;
        for (const client of room.clients) {
          const payload = encodeSyncStep1(doc);
          this.observeOutbound(payload.byteLength);
          client.send(payload);
        }
      }).catch((error) => {
        if (room.disposed) return;
        console.error(`[collab] failed to load room ${roomId}:`, error);
        room.loaded = true;
        for (const pending of room.pendingMessages) {
          this.handleMessage(roomId, pending.socket, pending.raw);
        }
        room.pendingMessages.length = 0;
      });
    }

    return room;
  }

  connect(roomId: string, socket: SocketLike) {
    this.metrics.connectionsTotal += 1;
    const room = this.getOrCreateRoom(roomId);
    room.clients.add(socket);
    if (room.loaded) {
      const payload = encodeSyncStep1(room.doc);
      this.observeOutbound(payload.byteLength);
      socket.send(payload);
    }
    // Send existing presence state to the new client
    for (const [, entry] of room.socketPresence) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE_PRESENCE);
      encoding.writeVarString(encoder, entry.payload);
      const msg = encoding.toUint8Array(encoder);
      this.observeOutbound(msg.byteLength);
      socket.send(msg);
    }
  }

  disconnect(roomId: string, socket: SocketLike) {
    this.metrics.disconnectionsTotal += 1;
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.clients.delete(socket);

    // Broadcast presence removal to remaining clients
    const entry = room.socketPresence.get(socket);
    if (entry && room.clients.size > 0) {
      const removalPayload = JSON.stringify({
        clientId: entry.clientId,
        user: { id: "", name: "", color: "" },
        cursor: null,
        removed: true,
      });
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE_PRESENCE);
      encoding.writeVarString(encoder, removalPayload);
      const msg = encoding.toUint8Array(encoder);
      for (const client of room.clients) {
        this.observeOutbound(msg.byteLength);
        client.send(msg);
      }
    }
    room.socketPresence.delete(socket);

    if (room.clients.size === 0) {
      this.saveRoom(room).finally(() => {
        room.dispose();
      });
      this.rooms.delete(roomId);
    }
  }

  handleMessage(roomId: string, socket: SocketLike, rawMessage: unknown) {
    const startedAt = performance.now();
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (!room.loaded) {
      room.pendingMessages.push({ socket, raw: rawMessage });
      return;
    }

    const message = toUint8Array(rawMessage);
    if (!message) return;
    this.observeInbound(message.byteLength);
    this.metrics.messagesTotal += 1;

    try {
      const decoder = decoding.createDecoder(message);
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);

      if (messageType === WS_MESSAGE_SYNC) {
        this.metrics.syncMessagesTotal += 1;
        encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, socket);
        const reply = encoding.toUint8Array(encoder);
        if (reply.length > 1) {
          this.observeOutbound(reply.byteLength);
          socket.send(reply);
        }
      } else if (messageType === WS_MESSAGE_PERF_PROBE) {
        this.metrics.perfProbeMessagesTotal += 1;
        const rawPayload = decoding.readVarString(decoder);
        const outbound = encoding.createEncoder();
        encoding.writeVarUint(outbound, WS_MESSAGE_PERF_PROBE);
        encoding.writeVarString(outbound, rawPayload);
        const payload = encoding.toUint8Array(outbound);

        for (const client of room.clients) {
          if (client !== socket) {
            this.observeOutbound(payload.byteLength);
            client.send(payload);
          }
        }
      } else if (messageType === WS_MESSAGE_PRESENCE) {
        const rawPayload = decoding.readVarString(decoder);
        // Track presence per socket for new-client catch-up and disconnect cleanup
        try {
          const parsed = JSON.parse(rawPayload) as { clientId: number };
          room.socketPresence.set(socket, { clientId: parsed.clientId, payload: rawPayload });
        } catch { /* ignore parse errors for tracking */ }

        // Broadcast to all other clients (no Yjs involved)
        const outbound = encoding.createEncoder();
        encoding.writeVarUint(outbound, WS_MESSAGE_PRESENCE);
        encoding.writeVarString(outbound, rawPayload);
        const presenceMsg = encoding.toUint8Array(outbound);
        for (const client of room.clients) {
          if (client !== socket) {
            this.observeOutbound(presenceMsg.byteLength);
            client.send(presenceMsg);
          }
        }
      } else if (messageType === WS_MESSAGE_AI) {
        const payload = decoding.readVarString(decoder);
        if (this.onAiMessage) {
          this.onAiMessage(roomId, socket, room.doc, payload);
        }
      }
    } catch (error) {
      this.metrics.invalidMessagesTotal += 1;
      console.error("[collab] invalid message:", error);
    } finally {
      this.observeProcessingDuration(performance.now() - startedAt);
    }
  }

  getDoc(roomId: string): Y.Doc | null {
    const room = this.rooms.get(roomId);
    if (!room || !room.loaded || room.disposed) return null;
    return room.doc;
  }

  /**
   * Pause broadcasting Yjs updates for a room. Updates from server-side
   * mutations (e.g. AI agent) are queued and flushed when `resumeBroadcast`
   * is called. Client-originated sync messages still flow normally.
   */
  pauseBroadcast(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.broadcastPaused = true;
  }

  /**
   * Resume broadcasting and flush all queued updates as a single merged
   * update to every connected client.
   */
  resumeBroadcast(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.broadcastPaused = false;

    if (room.pendingUpdates.length === 0) return;

    const merged = Y.mergeUpdates(room.pendingUpdates);
    room.pendingUpdates.length = 0;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, merged);
    const payload = encoding.toUint8Array(encoder);

    for (const client of room.clients) {
      this.observeOutbound(payload.byteLength);
      client.send(payload);
    }
  }

  /**
   * Resume broadcasting and flush all queued updates. Sends WS_MESSAGE_AI_SYNC
   * only to the requesting client (so their UndoManager tracks it); sends
   * normal WS_MESSAGE_SYNC to all other clients (so they get the update but
   * cannot undo it).
   */
  resumeBroadcastAsAi(roomId: string, originSocket: SocketLike): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.broadcastPaused = false;

    if (room.pendingUpdates.length === 0) return;

    const merged = Y.mergeUpdates(room.pendingUpdates);
    room.pendingUpdates.length = 0;

    // AI_SYNC for the requesting client (UndoManager tracks it)
    const aiEncoder = encoding.createEncoder();
    encoding.writeVarUint(aiEncoder, WS_MESSAGE_AI_SYNC);
    encoding.writeVarUint8Array(aiEncoder, merged);
    const aiPayload = encoding.toUint8Array(aiEncoder);

    // Normal SYNC for everyone else (UndoManager ignores it)
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, WS_MESSAGE_SYNC);
    syncProtocol.writeUpdate(syncEncoder, merged);
    const syncPayload = encoding.toUint8Array(syncEncoder);

    for (const client of room.clients) {
      const payload = client === originSocket ? aiPayload : syncPayload;
      this.observeOutbound(payload.byteLength);
      client.send(payload);
    }
  }

  getDebugSnapshot() {
    return Array.from(this.rooms.values()).map((room) => ({
      roomId: room.id,
      clients: room.clients.size,
      presenceEntries: room.socketPresence.size
    }));
  }

  getMetricsSnapshot() {
    return {
      ...this.metrics,
      roomCount: this.rooms.size
    };
  }
}
