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

function toWebSocketURL(roomId: string) {
  const apiURL = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000");
  apiURL.protocol = apiURL.protocol === "https:" ? "wss:" : "ws:";
  apiURL.pathname = `/ws/collab/${roomId}`;
  return apiURL.toString();
}

export function createCollabConnection(args: {
  roomId: string;
  user: PresenceUser;
  onStatesChange: (states: Map<number, PresenceState>, localClientId: number) => void;
  onConnectionStateChange?: (state: "connecting" | "connected" | "disconnected") => void;
  onPerfProbe?: (probe: PerfProbeMessage & { latencyMs: number }) => void;
}) {
  const doc = new Y.Doc();
  const presence = doc.getMap<PresenceState>("presence");
  const ws = new WebSocket(toWebSocketURL(args.roomId));
  ws.binaryType = "arraybuffer";
  args.onConnectionStateChange?.("connecting");

  const send = (payload: Uint8Array) => {
    if (ws.readyState === WebSocket.OPEN) {
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
    if (origin === ws) return; // skip updates that came from the server
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

  ws.onopen = () => {
    args.onConnectionStateChange?.("connected");
    sendSyncStep1();
    publishPresence(null);
  };

  ws.onmessage = (event) => {
    const raw = event.data;
    if (!(raw instanceof ArrayBuffer)) return; // binaryType is arraybuffer

    const data = new Uint8Array(raw);
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);

    if (messageType === WS_MESSAGE_SYNC) {
      encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
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

  ws.onclose = () => {
    args.onConnectionStateChange?.("disconnected");
  };

  ws.onerror = () => {
    args.onConnectionStateChange?.("disconnected");
  };

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
    presence.delete(String(doc.clientID));
    ws.close();
    doc.off("update", handleDocUpdate);
    presence.unobserve(emitStates);
    doc.destroy();
  };

  return { doc, disconnect, setCursor, sendPerfProbe };
}
