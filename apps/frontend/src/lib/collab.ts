import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

import {
  type AiChatRequest,
  type AiChatResponse,
  type AiConversationMessage,
  type PerfProbeKind,
  type PerfProbeMessage,
  type PresenceState,
  type PresenceUser,
  WS_MESSAGE_AI,
  WS_MESSAGE_AI_SYNC,
  WS_MESSAGE_PERF_PROBE,
  WS_MESSAGE_PRESENCE,
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
const CURSOR_THROTTLE_MS = 50;

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
  onAiResponse?: (response: AiChatResponse) => void;
}) {
  const doc = new Y.Doc();

  let ws: WebSocket | null = null;
  let disposed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Lightweight presence state (not in Yjs)
  const remotePresence = new Map<number, PresenceState>();

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

  const publishPresence = (cursor: { x: number; y: number } | null) => {
    const payload = JSON.stringify({
      clientId: doc.clientID,
      user: args.user,
      cursor,
    });
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_PRESENCE);
    encoding.writeVarString(encoder, payload);
    send(encoding.toUint8Array(encoder));
  };

  const emitStates = () => {
    const states = new Map<number, PresenceState>();
    states.set(doc.clientID, { user: args.user, cursor: null });
    for (const [clientId, state] of remotePresence) {
      states.set(clientId, state);
    }
    args.onStatesChange(states, doc.clientID);
  };

  doc.on("update", handleDocUpdate);

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
      } else if (messageType === WS_MESSAGE_PRESENCE) {
        try {
          const rawPayload = decoding.readVarString(decoder);
          const payload = JSON.parse(rawPayload) as {
            clientId: number;
            user: PresenceUser;
            cursor: { x: number; y: number } | null;
            removed?: boolean;
          };
          if (payload.clientId === doc.clientID) return;
          if (payload.removed) {
            remotePresence.delete(payload.clientId);
          } else {
            remotePresence.set(payload.clientId, {
              user: payload.user,
              cursor: payload.cursor,
            });
          }
          emitStates();
        } catch {
          // ignore invalid presence messages
        }
      } else if (messageType === WS_MESSAGE_PERF_PROBE) {
        try {
          const rawPayload = decoding.readVarString(decoder);
          const payload = JSON.parse(rawPayload) as PerfProbeMessage;
          args.onPerfProbe?.({
            ...payload,
            latencyMs: Math.max(0, Date.now() - payload.sentAtMs)
          });
        } catch {
          // ignore invalid perf probes
        }
      } else if (messageType === WS_MESSAGE_AI) {
        try {
          const rawPayload = decoding.readVarString(decoder);
          const response = JSON.parse(rawPayload) as AiChatResponse;
          args.onAiResponse?.(response);
        } catch {
          args.onAiResponse?.({ type: "ai_response", id: "", text: "", toolCallSummary: [], error: "Failed to parse AI response" });
        }
      } else if (messageType === WS_MESSAGE_AI_SYNC) {
        const update = decoding.readVarUint8Array(decoder);
        Y.applyUpdate(doc, update, "ai-mutation");
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
    };
  }

  connectWs();

  let pendingCursor: { x: number; y: number } | null | undefined;
  let cursorRafId: number | null = null;
  let lastCursorSendAt = 0;
  let cursorThrottleTimer: ReturnType<typeof setTimeout> | null = null;

  const flushCursor = () => {
    cursorRafId = null;
    if (pendingCursor !== undefined) {
      const now = performance.now();
      const elapsed = now - lastCursorSendAt;
      if (elapsed >= CURSOR_THROTTLE_MS) {
        lastCursorSendAt = now;
        publishPresence(pendingCursor);
        pendingCursor = undefined;
      } else if (!cursorThrottleTimer) {
        cursorThrottleTimer = setTimeout(() => {
          cursorThrottleTimer = null;
          if (pendingCursor !== undefined) {
            lastCursorSendAt = performance.now();
            publishPresence(pendingCursor);
            pendingCursor = undefined;
          }
        }, CURSOR_THROTTLE_MS - elapsed);
      }
    }
  };

  const setCursor = (cursor: { x: number; y: number } | null) => {
    pendingCursor = cursor;
    if (cursorRafId === null) {
      cursorRafId = requestAnimationFrame(flushCursor);
    }
  };

  const sendAiMessage = (
    prompt: string,
    conversationHistory?: AiConversationMessage[],
    selectedElementIds?: string[]
  ): string => {
    const id = crypto.randomUUID();
    const request: AiChatRequest = {
      type: "ai_request",
      id,
      prompt,
      conversationHistory,
      selectedElementIds: selectedElementIds?.length ? selectedElementIds : undefined,
    };
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_AI);
    encoding.writeVarString(encoder, JSON.stringify(request));
    send(encoding.toUint8Array(encoder));
    return id;
  };

  const sendPerfProbe = (kind: PerfProbeKind, id: string) => {
    const payload: PerfProbeMessage = {
      id,
      kind,
      roomId: args.roomId,
      senderClientId: doc.clientID,
      sentAtMs: Date.now()
    };
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_PERF_PROBE);
    encoding.writeVarString(encoder, JSON.stringify(payload));
    send(encoding.toUint8Array(encoder));
  };

  const disconnect = () => {
    disposed = true;
    if (cursorRafId !== null) {
      cancelAnimationFrame(cursorRafId);
      cursorRafId = null;
    }
    if (cursorThrottleTimer !== null) {
      clearTimeout(cursorThrottleTimer);
      cursorThrottleTimer = null;
    }
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    publishPresence(null);
    if (ws) {
      ws.close();
      ws = null;
    }
    doc.off("update", handleDocUpdate);
    doc.destroy();
    args.onConnectionStateChange?.("disconnected");
  };

  return { doc, disconnect, setCursor, sendPerfProbe, sendAiMessage };
}
