import { Elysia } from "elysia";

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
// Bun/Node should not keep process alive only for periodic metrics.
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
function getSocket(ws: any): SocketLike {
  return ws.data._socket;
}

// NOTE: WS auth is not enforced server-side because Elysia's async
// beforeHandle returns a truthy Promise that silently skips WS handlers.
// The frontend guards canvas access via Better Auth session checks.
// TODO: add server-side WS auth once Elysia supports sync beforeHandle
// or by validating cookies inside the open handler.

export const collabWsPlugin = new Elysia({ name: "collab-ws" })
  .ws(COLLAB_WS_PATH, {
    open(ws) {
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
    },
    message(ws, message) {
      roomManager.handleMessage(getRoomId(ws), getSocket(ws), message);
    },
    close(ws) {
      roomManager.disconnect(getRoomId(ws), getSocket(ws));
    }
  })
  .get("/api/collab/debug", () => ({
    rooms: roomManager.getDebugSnapshot(),
    metrics: roomManager.getMetricsSnapshot()
  }));
