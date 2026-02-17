import { Elysia } from "elysia";

import { auth } from "../auth/auth";
import { RoomManager, type SocketLike } from "./room-manager";
import { drizzlePersistence } from "./persistence";
import { COLLAB_WS_PATH } from "./protocol";

const roomManager = new RoomManager(drizzlePersistence);
const METRICS_LOG_INTERVAL_MS = 30_000;
const collabMetricsInterval = setInterval(() => {
  console.info(
    JSON.stringify({
      type: "collab_metrics",
      at: new Date().toISOString(),
      ...roomManager.getMetricsSnapshot()
    })
  );
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
      roomManager.disconnect(getRoomId(ws), socket);
    }
  })
  .get("/api/collab/debug", () => ({
    rooms: roomManager.getDebugSnapshot(),
    metrics: roomManager.getMetricsSnapshot()
  }));
