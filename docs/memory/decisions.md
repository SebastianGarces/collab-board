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

---

### ADR-012: AI Agent uses Vercel AI SDK with Langfuse OTEL tracing
**Date:** 2026-02-18
**Status:** superseded by ADR-013
**Context:** The AI board agent needs LLM integration, function calling, and observability for cost analysis. Multiple SDK options were evaluated (LangChain, Vercel AI SDK, raw OpenAI SDK).
**Decision:** Use Vercel AI SDK (`ai` + `@ai-sdk/openai`) with `generateText()` + `stopWhen: stepCountIs(10)` for multi-step commands. Langfuse observability via OpenTelemetry (`@langfuse/otel` + `@langfuse/tracing`) initialized before any AI SDK calls. AI commands flow over a new `WS_MESSAGE_AI=2` WebSocket channel as JSON-in-lib0-varString. Batch tools (`batchCreateElements`, `batchModifyElements`) handle multi-element operations in a single Yjs transaction. Per-tool execution is traced with custom Langfuse spans via `startObservation()`.
**Consequences:** Automatic capture of LLM tokens/cost/latency via OTEL, plus granular per-tool spans. The AI handler runs in the main process (I/O-bound await doesn't block the event loop). Cost analysis script queries the Langfuse Metrics API. AI SDK v6 requires `inputSchema` (with `zodSchema()` wrapper) instead of `parameters`, and `stopWhen` instead of `maxSteps`.

---

### ADR-013: AI Agent uses LangChain.js with Langfuse CallbackHandler
**Date:** 2026-02-19
**Status:** superseded by ADR-014
**Context:** AI command latency exceeded performance budgets (p95 5.4s vs 2s target). Classmates reported significant latency improvements (15s → &lt;2s) after switching from Vercel AI SDK to LangChain.
**Decision:** Replace Vercel AI SDK with LangChain.js (`@langchain/openai` + `@langchain/core`). Use `ChatOpenAI.bindTools()` with a manual tool-calling loop (max 4 steps). Langfuse tracing via `@langfuse/langchain` `CallbackHandler` passed to `model.invoke()`; OTEL `LangfuseSpanProcessor` retained for infrastructure. Tools defined with LangChain `tool()` from `@langchain/core/tools`, returning JSON strings. Keep camelCase tool names for compatibility with reliability scripts.
**Consequences:** Simpler, more direct API calls per step. CallbackHandler captures LLM and tool spans automatically. AI perf/reliability/trace-review scripts updated for LangChain observation names. WebSocket protocol and Yjs integration unchanged.

---

### ADR-014: Switch from Langfuse to LangSmith for AI observability
**Date:** 2026-02-19
**Status:** accepted
**Context:** Langfuse's LangChain integration via CallbackHandler produced unreliable trace structures. Single-step vs multi-step classification was fragile — observation counts didn't map cleanly to semantic step counts, causing perf budgets to never fire on single-step commands. LangSmith, as LangChain's native observability platform, provides first-class `run_type` typing (`llm`, `tool`, `chain`) for each span.
**Decision:** Replace Langfuse with LangSmith. Remove `@langfuse/*` and `@opentelemetry/sdk-node` packages. Use `traceable()` from `langsmith/traceable` to wrap `handleAiCommand` as the root trace with `tags: ["ai-command"]`. LangChain auto-traces `model.invoke()` and tool calls to LangSmith via `LANGCHAIN_TRACING_V2` env var. All analysis scripts (`ai-perf-check`, `ai-trace-review`, `ai-reliability-check`, `ai-cost-analysis`) rewritten to use the `langsmith` SDK `Client.listRuns()` with native `run_type` filtering. Classification: `tool` run count <= 1 = single-step, >= 2 = multi-step.
**Consequences:** Native LangChain integration means no callback handler needed — auto-tracing handles LLM and tool spans. Classification by `run_type === "tool"` count is deterministic. Langfuse env vars (`LANGFUSE_*`) no longer needed; LangSmith env vars (`LANGCHAIN_API_KEY`, `LANGCHAIN_TRACING_V2`, `LANGCHAIN_PROJECT`) required. Cost tracking via `run.total_cost`, `run.prompt_tokens`, `run.completion_tokens`.

---

### ADR-015: AI latency optimizations (skip Generation 2, gpt-4o-mini, tracing off hot path)
**Date:** 2026-02-19
**Status:** accepted
**Context:** Single-step AI command p95 was 3644ms (budget 2000ms). Two sequential LLM round-trips per command: (1) tool call generation, (2) summary text generation. The second call was redundant for mutations — `buildSummaryText()` already produces the same output.
**Decision:** (1) Skip the second LLM call when a mutation tool succeeds — break out of the agent loop and use `buildSummaryText()`. (2) Switch from gpt-4o to gpt-4o-mini for faster inference and lower cost. (3) Send response to client before `awaitAllCallbacks()` — fire-and-forget tracing flush.
**Consequences:** Single-step commands reduced from 2 LLM calls to 1. Expected p95 ~1200–2000ms. If gpt-4o-mini reliability drops below 80%, revert to gpt-4o and rely on optimizations 1 and 3 alone.

---

### ADR-016: AI latency optimizations (getBoardState O(k), prompt trim, deferred occupied region)
**Date:** 2026-02-19
**Status:** accepted
**Context:** Single-step p95 remained above 2000ms budget (2343ms). Analysis identified hotspots: getBoardState iterating all elements when elementIds provided, large system prompt, and unconditional occupied-region computation.
**Decision:** (1) In `getBoardState`, use direct `elementsMap.get(id)` for each requested ID instead of full forEach scan — O(k) vs O(n). (2) Trim SYSTEM_PROMPT verbosity; reduce MAX_HISTORY_MESSAGES from 10 to 6. (3) Compute occupied region only when prompt suggests create/layout (heuristic: create, add, make, draw, put, new, layout, arrange, grid, row, column). (4) Add traceable spans for ai-message-assembly and ai-summary-build for root-cause analysis.
**Consequences:** Lower token load and faster tool execution. Validation requires new traces from running the updated code; `ai:perf-check` uses historical traces.

---

### ADR-017: bulkCreateElements template tool for large batch creation
**Date:** 2026-02-19
**Status:** accepted
**Context:** gpt-4.1-nano cannot reliably generate 200+ element JSON arrays in a single tool call — it truncates or ignores the requested count (e.g. creates 6 instead of 200). Even capable models would need ~5000 output tokens for 200 elements, blowing the 2000ms latency budget.
**Decision:** Add a `bulkCreateElements` tool that accepts a compact template spec (type, count, columns, gap, colors, textPattern, frameTitle) and expands it server-side into individual Yjs elements. The model outputs ~50 tokens instead of ~5000. System prompt rule 14 directs the model to use this tool for 7+ elements of the same type.
**Consequences:** Bulk creation is deterministic and fast (server-side expansion). The model only needs to specify the pattern, not enumerate elements. For mixed-type batches or small counts (<7), `batchCreateElements` remains the right tool.

---

### ADR-018: Presentation mode — Yjs slideOrder + presence protocol
**Date:** 2026-02-21
**Status:** accepted
**Context:** Need presentation mode that turns frames into an ordered slide deck with smooth camera animation and collaborative following (one user presents, others follow).
**Decision:** Store slide order in `doc.getArray("slideOrder")` (Y.Array of frame IDs). Extend presence payload with optional `presenting: { slideIndex, slideOrder }`. Presenter broadcasts via presence; followers auto-sync to presenter's slide. Camera animation uses `applyCameraDirect` during animation (60fps), `setCameraState` only at end. Panel on left, overlay fullscreen with prev/next/exit.
**Consequences:** No schema change. Frame deletion must clean up slideOrder. Presence payload grows slightly when presenting. Backend forwards presence as-is.

---

### ADR-019: AI Vision — image-to-board via WebSocket base64
**Date:** 2026-02-21
**Status:** accepted
**Context:** Users want to upload/paste/drop photos of whiteboards, diagrams, or sketches and have the AI recreate them on the canvas.
**Decision:** Image flows through existing WebSocket AI pipeline as base64 data URL in `AiChatRequest.imageDataUrl`. No HTTP upload endpoint. Client resizes to max 1024px before encoding. Backend builds multimodal `HumanMessage` (text + image_url) for LangChain. Vision model (GPT-4o or Gemini) analyzes image and calls existing tools. Single-phase: image + tools in same agent turn.
**Consequences:** Payload ~200–500KB for 1024px PNG. Handler validates data URL format and 2MB encoded limit. Vision prompt addendum instructs model to map image content to compound tools (createDiagram, createColumnLayout, createQuadrant, batchCreateElements).

---

### ADR-020: Canvas performance boundary split (React vs renderer vs Yjs)
**Date:** 2026-02-22
**Status:** accepted
**Context:** The Canvas2D wrapper refactor introduced frame drops and broad rerenders during drag/pan/select because transient interaction state, renderer sync, and Yjs observation updates were tightly coupled.
**Decision:** Keep interaction and renderer updates mostly imperative per frame: batch `BoardCanvas -> renderer.setState` once per RAF, batch live drag overrides in one renderer call, keep high-frequency drag deltas out of Zustand writes, and expose incremental Yjs metadata (`changedIds`, `orderChanged`) so consumers can apply targeted updates (e.g. spatial index update/remove instead of full sync).
**Consequences:** React commit pressure during interaction is reduced, renderer hot-path allocations drop (no per-element override map merge), and Yjs-driven consumers can avoid O(n) rebuild work when only a subset of elements changes.
