# Known Issues

Check here before investigating a problem -- it may already be documented.

## Format

```
### [Short description]
**Date found:** YYYY-MM-DD
**Symptom:** [What you see]
**Cause:** [Root cause if known]
**Workaround:** [How to work around it, if any]
**Status:** open | resolved
```

---

### WebSocket connections have no server-side auth
**Date found:** 2026-02-16
**Symptom:** Anyone with a board's roomId can connect via WebSocket and read/write board content without authentication.
**Cause:** Elysia's async `beforeHandle` returns a truthy Promise that silently skips WebSocket handlers, preventing middleware-based auth.
**Fix:** Session validated in the async `open` handler via `auth.api.getSession({ headers })`. Unauthorized connections are closed immediately with code 4401. See `apps/backend/src/collab/ws.ts`.
**Status:** resolved (2026-02-17)

---

### No input validation or XSS sanitization on board content
**Date found:** 2026-02-16
**Symptom:** Raw text from sticky notes, text elements, and board names is stored directly in Yjs without sanitization. Malicious content could execute in other users' browsers.
**Cause:** No sanitization layer between user input and Yjs document storage. Text is rendered as-is in Konva canvas and overlay UI.
**Workaround:** None. Canvas rendering via Konva is somewhat safe (canvas text doesn't execute scripts), but overlay UI (React/DOM) could be vulnerable.
**Status:** open

---

### Yjs documents can grow unbounded in memory
**Date found:** 2026-02-16
**Symptom:** Long-lived rooms with heavy edit history may consume increasing server memory over time.
**Cause:** Yjs keeps full edit history for conflict resolution. No garbage collection or compaction is configured. Documents are held in-memory per room in the RoomManager.
**Workaround:** Rooms are disposed when the last client disconnects, releasing the document. For long-running rooms, periodic `Y.encodeStateAsUpdate()` and reloading could compact history, but this is not implemented.
**Status:** open

---

### No disconnect/reconnect resilience in collab.ts
**Date found:** 2026-02-16
**Symptom:** If the WebSocket connection drops (network issue, server restart), the client does not attempt to reconnect. The connection just dies.
**Cause:** `apps/frontend/src/lib/collab.ts` creates a single WebSocket with no retry or exponential backoff logic.
**Fix:** Added exponential backoff reconnect (1s base, 30s max, 30% jitter). The Y.Doc persists across reconnects so local state is preserved. New "reconnecting" connection state shown in header UI.
**Status:** resolved (2026-02-17)

---

### Race condition potential in Yjs persistence
**Date found:** 2026-02-16
**Symptom:** Concurrent saves for the same room could potentially overlap if the save interval fires while a previous save is still in progress.
**Cause:** No explicit locking or queue for persistence operations in `apps/backend/src/collab/persistence.ts`. The 30-second save interval uses a simple `setInterval`.
**Workaround:** Unlikely to occur in practice at current scale (single-process, low concurrency). Would need a save queue or mutex for production.
**Status:** open

---

### Board elements not loading on initial join / inconsistent on refresh
**Date found:** 2026-02-17
**Symptom:** When a user opens a shared canvas URL, the board appears empty. Refreshing sometimes loads elements, sometimes doesn't. Inconsistent behavior.
**Cause:** Two separate race conditions in the backend:
1. **Async auth drops sync messages (ws.ts):** The WebSocket `open` handler is `async` (awaits `getSession`). While auth is pending, the client's initial sync step 1 message arrives but is silently dropped because `_socket` is not yet set. Without processing the client's sync step 1, the server never sends its sync step 2 (which contains the actual board data). The server's own sync step 1 only causes the client to send its (empty) data back — it doesn't push server data to the client.
2. **Unloaded room save corrupts DB (room-manager.ts):** React Strict Mode's double-mount (dev only) rapidly connects and disconnects. If the first disconnect fires before the DB load completes, `saveRoom` writes the empty Y.Doc state to the database, overwriting the real persisted data. The second connection then loads empty state.
**Fix:**
- `ws.ts`: Buffer messages received before `_socket` is set in a `_pendingMessages` array on `ws.data`. After auth completes and `roomManager.connect()` is called, replay all buffered messages.
- `room-manager.ts`: Guard `saveRoom` with `if (!room.loaded || room.disposed) return;`. Guard the async `loadState` callback with `if (room.disposed) return;`. Added `disposed: boolean` flag to the Room type, set in `dispose()`.
**Status:** resolved (2026-02-17)

---

### Playwright browsers fail to launch when run via Cursor agent sandbox
**Date found:** 2026-02-16
**Symptom:** `bun run perf:frontend:ci` fails with "Executable doesn't exist" or SEGV crash when run through Cursor's AI agent Shell tool.
**Cause:** Cursor's sandbox intercepts filesystem operations outside the workspace, redirecting Playwright's browser cache (`~/Library/Caches/ms-playwright/`) to a temporary `cursor-sandbox-cache` directory. This causes two problems: (1) install and test may resolve to different temp paths, so browsers are never found, and (2) the sandbox confuses Playwright's architecture detection, downloading x64 binaries on arm64 Macs, which crash with SIGSEGV.
**Workaround:** Fixed by setting `PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers` in the `test:perf:e2e` and `test:perf:e2e:ci` scripts in `apps/frontend/package.json`, storing browsers inside the workspace where the sandbox allows normal access. When running via Cursor agent, use `required_permissions: ["all"]` to avoid the sandbox re-downloading wrong-arch binaries. Running from a real terminal works with no special flags.
**Status:** resolved
