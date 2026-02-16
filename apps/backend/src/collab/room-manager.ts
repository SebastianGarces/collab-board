import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

import { WS_MESSAGE_PERF_PROBE, WS_MESSAGE_SYNC } from "@collab/shared/collab";

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
  /** Maps each socket to the presence keys it owns (for cleanup on disconnect). */
  socketPresenceKeys: Map<SocketLike, Set<string>>;
  /** Whether the initial DB state has been loaded. */
  loaded: boolean;
  /** Queue of messages received before the room finished loading. */
  pendingMessages: Array<{ socket: SocketLike; raw: unknown }>;
  /** Handle for the periodic save timer. */
  saveTimer: ReturnType<typeof setInterval> | null;
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
    const socketPresenceKeys = new Map<SocketLike, Set<string>>();
    const presence = doc.getMap("presence");

    // Broadcast doc updates to every client except the one that sent it.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
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

    // Track which presence keys each socket writes so we can clean up on disconnect.
    const onPresenceChange = (event: Y.YMapEvent<unknown>, transaction: Y.Transaction) => {
      const origin = transaction.origin;
      if (!origin || !clients.has(origin as SocketLike)) return;

      const socket = origin as SocketLike;
      for (const [key, change] of event.changes.keys) {
        if (change.action === "add" || change.action === "update") {
          let keys = socketPresenceKeys.get(socket);
          if (!keys) {
            keys = new Set();
            socketPresenceKeys.set(socket, keys);
          }
          keys.add(key);
        }
      }
    };

    doc.on("update", onUpdate);
    presence.observe(onPresenceChange);

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
      socketPresenceKeys,
      loaded: !this.persistence,
      pendingMessages: [],
      saveTimer,
      dispose: () => {
        if (saveTimer) clearInterval(saveTimer);
        presence.unobserve(onPresenceChange);
        doc.off("update", onUpdate);
        doc.destroy();
      }
    };

    this.rooms.set(roomId, room);

    if (this.persistence) {
      this.persistence.loadState(roomId).then((state) => {
        if (state && state.length > 0) {
          Y.applyUpdate(doc, state);
        }
        // Clear stale presence entries from the persisted state.
        // All presence data is transient; real clients will re-publish on connect.
        const persistedPresence = doc.getMap("presence");
        if (persistedPresence.size > 0) {
          doc.transact(() => {
            persistedPresence.clear();
          });
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
  }

  disconnect(roomId: string, socket: SocketLike) {
    this.metrics.disconnectionsTotal += 1;
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.clients.delete(socket);

    // Remove presence entries owned by the disconnecting socket.
    const keys = room.socketPresenceKeys.get(socket);
    if (keys && keys.size > 0) {
      const presence = room.doc.getMap("presence");
      for (const key of keys) {
        presence.delete(key);
      }
    }
    room.socketPresenceKeys.delete(socket);

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
      }
    } catch (error) {
      this.metrics.invalidMessagesTotal += 1;
      console.error("[collab] invalid message:", error);
    } finally {
      this.observeProcessingDuration(performance.now() - startedAt);
    }
  }

  getDebugSnapshot() {
    return Array.from(this.rooms.values()).map((room) => ({
      roomId: room.id,
      clients: room.clients.size,
      presenceEntries: room.doc.getMap("presence").size
    }));
  }

  getMetricsSnapshot() {
    return {
      ...this.metrics,
      roomCount: this.rooms.size
    };
  }
}
