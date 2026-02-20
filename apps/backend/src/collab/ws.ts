import { Elysia } from "elysia";

import { auth } from "../auth/auth";
import { RoomManager, type SocketLike } from "./room-manager";
import { drizzlePersistence } from "./persistence";
import { COLLAB_WS_PATH } from "./protocol";
import { handleAiMessage } from "../ai/handler";

const roomManager = new RoomManager(drizzlePersistence);

roomManager.onAiMessage = (roomId, socket, doc, payload) => {
  const userId = socketUserIds.get(socket) ?? "unknown";
  handleAiMessage(roomId, socket, doc, payload, userId, roomManager).catch((err) => {
    console.error("[collab] AI handler error:", err);
  });
};

const socketUserIds = new Map<SocketLike, string>();
const METRICS_LOG_INTERVAL_MS = 30_000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMetrics(m: ReturnType<typeof roomManager.getMetricsSnapshot>): string {
  const b = m.processingBuckets;
  const total = b.le_1ms + b.le_5ms + b.le_10ms + b.le_25ms + b.le_50ms + b.gt_50ms;
  const pctBar = (count: number) => {
    const pct = total > 0 ? (count / total) * 100 : 0;
    return `${String(count).padStart(6)} ${pct > 0 ? `(${pct.toFixed(0)}%)` : ""}`;
  };

  return [
    `[collab] ── metrics ──────────────────────────────`,
    `  rooms: ${m.roomCount}  |  conns: +${m.connectionsTotal} / -${m.disconnectionsTotal}`,
    `  messages: ${m.messagesTotal.toLocaleString()} total  (sync: ${m.syncMessagesTotal.toLocaleString()}, probe: ${m.perfProbeMessagesTotal}, invalid: ${m.invalidMessagesTotal})`,
    `  traffic:  in ${formatBytes(m.bytesInTotal)}  |  out ${formatBytes(m.bytesOutTotal)}`,
    `  latency:  ≤1ms ${pctBar(b.le_1ms)}  |  ≤5ms ${pctBar(b.le_5ms)}  |  ≤10ms ${pctBar(b.le_10ms)}`,
    `            ≤25ms ${pctBar(b.le_25ms)}  |  ≤50ms ${pctBar(b.le_50ms)}  |  >50ms ${pctBar(b.gt_50ms)}`,
    `  ─────────────────────────────────────────────────`,
  ].join("\n");
}

const collabMetricsInterval = setInterval(() => {
  console.info(formatMetrics(roomManager.getMetricsSnapshot()));
}, METRICS_LOG_INTERVAL_MS);
collabMetricsInterval.unref?.();

function getRoomId(ws: any): string {
  return ws.data.params.roomId;
}

/**
 * Elysia may pass a different ws wrapper object to each event handler
 * (open, message, close), so we can't rely on ws identity for tracking.
 * Instead we create the SocketLike once in `open` and stash it on
 * `ws.data` which IS stable across all handlers for the same connection.
 */
function getSocket(ws: any): SocketLike | undefined {
  return ws.data._socket;
}

export const collabWsPlugin = new Elysia({ name: "collab-ws" })
  .ws(COLLAB_WS_PATH, {
    async open(ws) {
      (ws.data as any)._pendingMessages = [];

      const headers = (ws.data as any).request?.headers as Headers | undefined;
      if (!headers) {
        (ws.data as any)._pendingMessages = null;
        ws.close(4401, "Unauthorized");
        return;
      }

      const session = await auth.api.getSession({ headers });
      if (!session) {
        (ws.data as any)._pendingMessages = null;
        ws.close(4401, "Unauthorized");
        return;
      }

      const socket: SocketLike = {
        send(data: Uint8Array) {
          try {
            ws.send(Buffer.from(data));
          } catch {
            // client likely disconnected
          }
        }
      };
      (ws.data as any)._socket = socket;
      socketUserIds.set(socket, session.user.id);
      roomManager.connect(getRoomId(ws), socket);

      // Replay messages that arrived while awaiting auth
      const pending = (ws.data as any)._pendingMessages as unknown[] | null;
      (ws.data as any)._pendingMessages = null;
      if (pending) {
        for (const msg of pending) {
          roomManager.handleMessage(getRoomId(ws), socket, msg);
        }
      }
    },
    message(ws, message) {
      const socket = getSocket(ws);
      if (!socket) {
        // Auth still in progress — buffer the message for replay after connect
        const pending = (ws.data as any)._pendingMessages as unknown[] | null;
        if (pending) {
          pending.push(message);
        }
        return;
      }
      roomManager.handleMessage(getRoomId(ws), socket, message);
    },
    close(ws) {
      (ws.data as any)._pendingMessages = null;
      const socket = getSocket(ws);
      if (!socket) return;
      socketUserIds.delete(socket);
      roomManager.disconnect(getRoomId(ws), socket);
    }
  })
  .get("/api/collab/debug", () => ({
    rooms: roomManager.getDebugSnapshot(),
    metrics: roomManager.getMetricsSnapshot()
  }));
