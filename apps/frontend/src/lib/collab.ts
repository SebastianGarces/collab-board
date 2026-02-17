import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

import {
  type PerfProbeKind,
  type PerfProbeMessage,
  type PresenceState,
  type PresenceUser,
  WS_MESSAGE_PERF_PROBE,
  WS_MESSAGE_SYNC
} from "@collab/shared/collab";

export type Camera = {
  x: number;
  y: number;
  scale: number;
};

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_JITTER = 0.3;

function toWebSocketURL(roomId: string) {
  const apiURL = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000");
  apiURL.protocol = apiURL.protocol === "https:" ? "wss:" : "ws:";
  apiURL.pathname = `/ws/collab/${roomId}`;
  return apiURL.toString();
}

function backoffDelay(attempt: number): number {
  const base = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
  return Math.max(0, base + jitter);
}

export function createCollabConnection(args: {
  roomId: string;
  user: PresenceUser;
  onStatesChange: (states: Map<number, PresenceState>, localClientId: number) => void;
  onConnectionStateChange?: (state: ConnectionState) => void;
  onPerfProbe?: (probe: PerfProbeMessage & { latencyMs: number }) => void;
}) {
  const doc = new Y.Doc();
  const presence = doc.getMap<PresenceState>("presence");

  let ws: WebSocket | null = null;
  let disposed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const send = (payload: Uint8Array) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  };

  const sendSyncStep1 = () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(encoding.toUint8Array(encoder));
  };

  const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === ws) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    send(encoding.toUint8Array(encoder));
  };

  const emitStates = () => {
    const states = new Map<number, PresenceState>();
    presence.forEach((value, key) => {
      const id = Number(key);
      if (!Number.isFinite(id) || !value?.user) return;
      states.set(id, value);
    });
    args.onStatesChange(states, doc.clientID);
  };

  doc.on("update", handleDocUpdate);
  presence.observe(emitStates);

  const publishPresence = (cursor: { x: number; y: number } | null) => {
    presence.set(String(doc.clientID), {
      user: args.user,
      cursor
    });
  };

  const scheduleReconnect = () => {
    if (disposed) return;
    const delay = backoffDelay(reconnectAttempt);
    reconnectAttempt++;
    args.onConnectionStateChange?.("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!disposed) connectWs();
    }, delay);
  };

  function connectWs() {
    if (disposed) return;
    const socket = new WebSocket(toWebSocketURL(args.roomId));
    socket.binaryType = "arraybuffer";
    ws = socket;

    args.onConnectionStateChange?.(reconnectAttempt === 0 ? "connecting" : "reconnecting");

    socket.onopen = () => {
      if (disposed || ws !== socket) {
        socket.close();
        return;
      }
      reconnectAttempt = 0;
      args.onConnectionStateChange?.("connected");
      sendSyncStep1();
      publishPresence(null);
    };

    socket.onmessage = (event) => {
      if (ws !== socket) return;
      const raw = event.data;
      if (!(raw instanceof ArrayBuffer)) return;

      const data = new Uint8Array(raw);
      const decoder = decoding.createDecoder(data);
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);

      if (messageType === WS_MESSAGE_SYNC) {
        encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, socket);
        const reply = encoding.toUint8Array(encoder);
        if (reply.length > 1) {
          send(reply);
        }
      } else if (messageType === WS_MESSAGE_PERF_PROBE) {
        try {
          const rawPayload = decoding.readVarString(decoder);
          const payload = JSON.parse(rawPayload) as PerfProbeMessage;
          args.onPerfProbe?.({
            ...payload,
            latencyMs: Math.max(0, performance.now() - payload.sentAtMs)
          });
        } catch {
          // ignore invalid perf probes
        }
      }
    };

    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (!disposed) {
        scheduleReconnect();
      } else {
        args.onConnectionStateChange?.("disconnected");
      }
    };

    socket.onerror = () => {
      if (ws !== socket) return;
      // onclose will fire after onerror, which triggers reconnect
    };
  }

  connectWs();

  const setCursor = (cursor: { x: number; y: number } | null) => {
    publishPresence(cursor);
  };

  const sendPerfProbe = (kind: PerfProbeKind, id: string) => {
    const payload: PerfProbeMessage = {
      id,
      kind,
      roomId: args.roomId,
      senderClientId: doc.clientID,
      sentAtMs: performance.now()
    };
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_PERF_PROBE);
    encoding.writeVarString(encoder, JSON.stringify(payload));
    send(encoding.toUint8Array(encoder));
  };

  const disconnect = () => {
    disposed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    presence.delete(String(doc.clientID));
    if (ws) {
      ws.close();
      ws = null;
    }
    doc.off("update", handleDocUpdate);
    presence.unobserve(emitStates);
    doc.destroy();
    args.onConnectionStateChange?.("disconnected");
  };

  return { doc, disconnect, setCursor, sendPerfProbe };
}
