# Architecture Decisions

Append-only log. Never edit past entries. If a decision is superseded, add a new entry referencing the old one.

## Format

```
### ADR-NNN: [Title]
**Date:** YYYY-MM-DD
**Status:** accepted | superseded by ADR-NNN
**Context:** [Why this decision was needed -- 1-2 sentences]
**Decision:** [What we chose -- 1-2 sentences]
**Consequences:** [What follows from this choice]
```

---

### ADR-001: Yjs for CRDT-based real-time sync
**Date:** 2026-02-16
**Status:** accepted
**Context:** Need real-time collaborative editing with conflict resolution for multiple concurrent users on the same board.
**Decision:** Use Yjs (state-based CRDT library) over WebSocket, rather than a custom CRDT implementation. Aligns with the LWW Map composition pattern but uses Yjs's optimized internals.
**Consequences:** Yjs handles merge conflicts automatically. Board content lives in Y.Doc as Y.Map structures. Server holds in-memory Yjs docs per room, periodically snapshots to PostgreSQL. Yjs documents can grow unbounded in memory if not garbage-collected.

---

### ADR-002: Konva.js for canvas rendering
**Date:** 2026-02-16
**Status:** accepted
**Context:** Need a canvas library that handles 500+ objects at 60fps with built-in transforms (drag, resize, rotate, hit detection) and React bindings.
**Decision:** Use Konva.js with `react-konva` for declarative rendering. Canvas-based (not SVG/DOM) for performance.
**Consequences:** Medium lock-in to Konva API for rendering. Layer system separates background, objects, selection, and cursors. Overlay UI (toolbars, panels) uses shadcn/ui positioned absolutely over the Konva canvas.

---

### ADR-003: Better Auth for authentication
**Date:** 2026-02-16
**Status:** accepted
**Context:** Need auth that works with Drizzle ORM, supports email/password, and is TypeScript-first.
**Decision:** Use Better Auth with cookie-based sessions, Drizzle adapter, and seeded demo accounts for evaluators.
**Consequences:** Auth tables managed by Better Auth in the same PostgreSQL database. HTTP routes validate session via middleware. WebSocket auth is a known gap -- currently relies on frontend guards only.

---

### ADR-004: Railway for deployment
**Date:** 2026-02-16
**Status:** accepted
**Context:** Need hosting that supports long-lived WebSocket connections, includes PostgreSQL, and has a free tier for demos.
**Decision:** Railway with two services: `backend` (Elysia/Bun) and `frontend` (Next.js standalone). Auto-deploy from GitHub.
**Consequences:** Free tier sufficient for demo (500 hours/month). For production, multi-instance WebSocket would need sticky sessions or pub/sub layer.

---

### ADR-005: AI mutations flow through the server
**Date:** 2026-02-16
**Status:** accepted
**Context:** AI agent needs to create/modify board elements. Need to decide whether AI mutations happen client-side or server-side.
**Decision:** AI commands arrive via WebSocket, execute server-side against the Yjs doc, and sync to all clients through normal Yjs sync. The client never applies AI mutations directly.
**Consequences:** Single write authority for AI. All users see AI changes in real-time. Requires the AI backend module (`ai/`) to have access to the room's Yjs document.

---

### ADR-006: PostgreSQL for metadata, Yjs for board content
**Date:** 2026-02-16
**Status:** accepted
**Context:** Need to separate transient board content (elements, positions) from durable metadata (board names, ownership, access control).
**Decision:** Yjs document is the single source of truth for board content. PostgreSQL stores metadata and periodic Yjs snapshots (base64-encoded binary state). Never read/write board element state directly to PostgreSQL.
**Consequences:** Board loads by hydrating Yjs doc from snapshot. Periodic saves (30s interval) prevent data loss. Presence data is transient and not persisted.

---

### ADR-008: Zustand for canvas interaction state
**Date:** 2026-02-17
**Status:** accepted
**Context:** Multi-select and group drag require shared state (selected element IDs, drag deltas) accessible from deeply nested canvas components (`BoardCanvas`, `InteractiveShape`) and the page-level component. React Context would re-render the entire subtree on every change; local state required prop-drilling through dynamic imports.
**Decision:** Use Zustand v5 for canvas-level interaction state. Store manages `selectedElementIds`, `groupDrag` (drag offsets for multi-select move), and associated actions. Components subscribe via fine-grained selectors to minimize re-renders.
**Consequences:** Zustand store is a singleton across the app. Selection state persists across client-side navigations (should be cleared when changing boards). Selectors MUST return primitives or stable references — returning new objects causes infinite render loops with `useSyncExternalStore`. Store file: `apps/frontend/src/stores/canvas-store.ts`.

---

### ADR-009: WebSocket message buffering during async auth
**Date:** 2026-02-17
**Status:** accepted
**Context:** The Elysia WebSocket `open` handler is async (awaits `getSession` for auth). Messages arriving during the await are silently dropped because `_socket` is not yet set. This causes the client's initial Yjs sync step 1 to be lost, preventing board data from loading.
**Decision:** Buffer incoming messages in a `_pendingMessages` array on `ws.data` during the auth await. After auth completes and `roomManager.connect()` is called, replay all buffered messages in order. On auth failure or close, discard the buffer.
**Consequences:** Sync messages are never lost regardless of auth timing. Pattern applies to any async WebSocket open handler — always buffer messages until the handler completes.

---

### ADR-007: shadcn/ui + Tailwind for overlay UI
**Date:** 2026-02-16
**Status:** accepted
**Context:** Need UI components for toolbars, panels, dialogs, and AI chat that overlay the canvas without interfering with Konva rendering.
**Decision:** shadcn/ui (Radix primitives, Tailwind CSS) for all non-canvas UI. Components are copy-paste owned, fully customizable. Dark theme by default.
**Consequences:** No lock-in (you own the components). Overlay UI is pointer-events-none during canvas interaction. Tailwind utilities used throughout.

---

### ADR-010: Connector element with reference-based endpoints
**Date:** 2026-02-17
**Status:** accepted
**Context:** Connectors need to link two shapes and follow them when moved. Unlike other elements that are fully positioned by x/y/width/height, connectors derive their visual path from endpoint positions which may be anchored to other elements.
**Decision:** Store `fromId/toId` (attached element IDs) and `fromX/fromY/toX/toY` (absolute coordinates) on the connector. At render time, `resolveEndpoints()` recomputes anchor positions from connected shapes' bounding boxes. Path routing (straight/curved/orthogonal) is computed per-render via `computePath()`. The connector's `x/y/width/height` is the bounding box of the two endpoints, used only for selection hit testing and toolbar positioning. Connectors use `InteractiveShape` with `resizable={false}`, `draggable={false}`, and custom endpoint/midpoint handle components.
**Consequences:** Connectors reactively follow connected shapes without explicit update logic. Endpoint snapping uses `findSnapTarget()` at drag-end to attach to nearby shapes. Selection toolbar has 3 states (default, has-label, editing-label) managed via `editingConnectorLabel` boolean in page component.

---

### ADR-011: Frontend canvas updates must be throttled and selector-driven
**Date:** 2026-02-17
**Status:** accepted
**Context:** Heavy boards (dozens of frames and hundreds of objects) caused interaction regressions: low FPS, slow selection toolbar/dropdowns, and lag during resize/drag operations due to broad rerenders and per-event Yjs writes.
**Decision:** Adopt a performance baseline that (1) keeps transient pointer state out of top-level React state, (2) batches high-frequency drag/resize/rotate writes to Yjs on `requestAnimationFrame`, (3) relies on narrow Zustand selectors with `useShallow` when grouping values, and (4) culls offscreen canvas elements while keeping selected elements rendered.
**Consequences:** Canvas interaction remains responsive under higher object counts, overlay controls become less sensitive to pointer churn, and perf budgets now include `inputToRenderMs` and long-frame enforcement to catch regressions in CI.
