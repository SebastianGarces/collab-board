# Code Conventions

Living document. Update this as patterns are discovered or established.

**How to update:** When you notice a consistent pattern (or establish a new one), add it here with a file reference. Match patterns in surrounding code when this file has no relevant entry.

---

## Naming

- **Files**: kebab-case (`room-manager.ts`, `auth-client.ts`, `board-canvas.tsx`)
- **React components**: PascalCase (`StickyNote`, `BoardCanvas`, `InteractiveShape`)
- **Functions/variables**: camelCase (`getOrCreateRoom`, `elementsMap`, `handleDragEnd`)
- **Types/interfaces**: PascalCase (`BoardElement`, `PresenceState`, `AuthUser`)
- **Constants**: SCREAMING_SNAKE_CASE for true constants (`WS_MESSAGE_SYNC`, `STICKY_NOTE_COLORS`), camelCase for config objects
- **Element type strings**: kebab-case (`"sticky-note"`, `"rectangle"`, `"circle"`, `"line"`, `"text"`, `"connector"`)

## File Structure

- **Element components**: One file per element type in `apps/frontend/src/components/canvas/` (e.g., `sticky-note.tsx`, `rectangle-element.tsx`)
- **Backend modules**: Feature directories under `apps/backend/src/` (e.g., `collab/`, `boards/`, `auth/`, `db/`)
- **Shared types**: Exported from `packages/shared/src/` with barrel re-exports in `index.ts`
- **Hooks**: `apps/frontend/src/hooks/` with `use-` prefix (e.g., `use-yjs-elements.ts`)
- **Stores**: `apps/frontend/src/stores/` with `-store` suffix (e.g., `canvas-store.ts`)
- **UI components**: shadcn/ui components in `apps/frontend/src/components/ui/`
- **Board overlay UI**: `apps/frontend/src/components/board/` for toolbar, layers panel, AI chat

## Code Patterns

- **Yjs mutations**: Always wrap in `doc.transact(() => { ... })` for atomic updates. See `apps/frontend/src/app/canvas/[roomId]/page.tsx`.
- **Yjs observation**: Use `observeDeep()` on Y.Map for reactive element updates. See `apps/frontend/src/hooks/use-yjs-elements.ts`.
- **Element type guard**: Use discriminated union on `type` field. `BoardElement` is a union of all element interfaces. See `packages/shared/src/collab.ts`.
- **Yjs-to-type conversion**: `yMapToElement()` converts Y.Map to typed BoardElement with safe fallbacks (`toFiniteNumber()`, `toSafeSize()`). See `apps/frontend/src/hooks/use-yjs-elements.ts`.
- **Konva rendering**: Content components are presentational (receive `element` prop, return Konva primitives). `InteractiveShape` wraps content to add drag/resize/select. See `apps/frontend/src/components/canvas/interactive-shape.tsx`.
- **Zustand stores**: One store per domain in `apps/frontend/src/stores/`. Selectors MUST return primitives or stable references — never create new objects/arrays inside a selector (causes infinite loops with `useSyncExternalStore`). For grouped values, use `useShallow` so object selectors stay stable. Store actions are stable references and safe to use as deps. See `apps/frontend/src/stores/canvas-store.ts`.
- **WebSocket binary protocol**: Uses `lib0` encoding/decoding. Message format is `[messageType: varuint][payload...]`. See `apps/backend/src/collab/room-manager.ts`.
- **WebSocket async open handler**: Always buffer messages received before the async `open` handler completes. Replay buffered messages after connection setup. See `apps/backend/src/collab/ws.ts`.
- **Persistence**: Adapter pattern with `loadState`/`saveState`. Yjs state encoded as base64 for PostgreSQL TEXT column. See `apps/backend/src/collab/persistence.ts`.
- **Room lifecycle**: Lazy creation on first client, disposal on last disconnect. Messages queued until initial DB load completes. Never save an unloaded room (`!room.loaded` guard). See `apps/backend/src/collab/room-manager.ts`.
- **Camera transform**: World-to-screen: `screenX = worldX * scale + offsetX`. Zoom keeps world point under cursor fixed. See `apps/frontend/src/app/canvas/[roomId]/page.tsx`.
- **HTML overlays on Konva canvas**: When positioning an HTML element (input, textarea) over a Konva shape, the HTML element must use `display: block`. Inputs are inline-replaced by default and inherit the parent's `line-height` (Tailwind base = 1.5), creating a line box taller than the element and shifting it down via baseline alignment. Also avoid `border` (use `ring-*` instead) since `border-box` sizing shrinks the content area and shifts text. See frame label and sticky note editing in `apps/frontend/src/app/canvas/[roomId]/page.tsx`.
- **Connector element pattern**: Connectors store absolute `fromX/fromY/toX/toY` endpoints plus optional `fromId/toId` for shape attachment. Position is resolved at render time via `resolveEndpoints()` which recomputes anchor points from connected shapes. Connectors use `InteractiveShape` with `resizable={false}`, `draggable={false}`, `hideSelectionOutline={true}`. Custom endpoint/midpoint handles render alongside the content. Path routing is computed per-render from endpoints via `computePath()`. See `apps/frontend/src/components/canvas/connector-utils.ts`.
- **Connector selection toolbar states**: 3-state toolbar: (1) no label + "T" button, (2) has label (no "T"), (3) editing label (text formatting controls). State tracked via `editingConnectorLabel` boolean in page component.
- **Presentation mode**: Slide order in `doc.getArray("slideOrder")`. Camera animation via `animateCamera()` uses `applyCameraDirect` during animation (60fps), `setCameraState` only at end. Presence `presenting` field broadcasts slide index for collaborative following. See `apps/frontend/src/lib/camera-animation.ts`, `presentation-panel.tsx`, `presentation-overlay.tsx`.
- **No default exports**: All modules use named exports only. Barrel re-exports in `packages/shared/src/index.ts`.

## Testing Patterns

- **Performance benchmarks**: JSONL output to `artifacts/perf/`. Scripts in `scripts/perf-*.ts`.
- **Performance budgets**: Defined in `docs/performance-budgets.json`, enforced by `scripts/perf-check.ts`.
- **WS benchmarks**: `apps/backend/src/collab/ws-benchmark.ts` tests cursor/object sync latency and object capacity using mock sockets.
- **Frontend perf**: Playwright spec collects FPS and latency metrics via `window.__collabPerf`.
- **Test file location**: Next to the code they test (`foo.ts` -> `foo.test.ts`).
