# CollabBoard Build Checklist

**Last updated**: February 22, 2026

This checklist tracks what has been implemented against the full spec in `collab-board.md`, informed by the architecture decisions in `pre-search.md`. Items are organized by dependency layer so you can work top-to-bottom without getting blocked.

---

## Status Legend

- [x] Done
- [ ] Not started
- [~] Partially done

---

## Dependency Graph

```
Layer 0 (depends on nothing) ✓ ALL DONE
├── WS auth enforcement ← DONE
├── Disconnect/reconnect resilience ← DONE
├── Dashboard page (board list, create, delete) ← DONE
├── Circle shape ← DONE
├── Line shape ← DONE
├── Standalone text elements ← DONE
├── Sticky note color picker UI ← DONE
├── Multi-select (shift-click + marquee) ← DONE
├── Rotate transform ← DONE
└── Input validation / XSS sanitization ← DONE

Layer 1 (depends on Layer 0) ✓ ALL DONE
├── Connectors ← DONE
├── Frames ← DONE
├── Duplicate operation ← DONE
└── Copy/paste ← DONE

Layer 2 (depends on Layer 1) ✓ ALL DONE
├── AI Agent: tool schema + OpenAI integration ← DONE
└── AI Agent: chat UI panel ← DONE

Layer 3 (depends on Layer 2) ✓ ALL DONE
├── AI Agent: complex multi-step commands ← DONE (maxSteps=10)
└── AI Agent: layout commands ← DONE (batch tools + system prompt)

Layer 4 (final — depends on everything above) ✓ ALL DONE
├── AI Development Log ← DONE
├── AI Cost Analysis ← DONE
├── Demo Video (3-5 min) ← DONE
├── Deployed application (public URL) ← DONE
└── Social Post (X or LinkedIn) ← DONE
```

---

## MVP Requirements (24-hour gate)

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | Infinite board with pan/zoom | [x] Done | Konva.js canvas, scroll-to-zoom, space+drag pan |
| 2 | Sticky notes with editable text | [x] Done | Random color on create, double-click to edit, textarea overlay |
| 3 | At least one shape type | [x] Done | Rectangle with drag-to-draw, fill/stroke |
| 4 | Create, move, and edit objects | [x] Done | Create via toolbar/keyboard, drag to move, resize handles |
| 5 | Real-time sync between 2+ users | [x] Done | Yjs CRDT over WebSocket, binary sync protocol |
| 6 | Multiplayer cursors with name labels | [x] Done | SVG cursor + name badge overlay, per-user color |
| 7 | Presence awareness (who's online) | [x] Done | Peer count in header, Yjs presence map |
| 8 | User authentication | [x] Done | Better Auth email/password, login/signup page |
| 9 | Deployed and publicly accessible | [x] Done | Railway, auto-deploy on push to main |

---

## Core Whiteboard — Board Features

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Workspace (infinite pan/zoom) | [x] Done | Min 0.2x, max 3x zoom, dot grid background |
| 2 | Sticky notes (create, edit, colors) | [x] Done | Color picker, font family/size, resizable. Selection toolbar with composable controls |
| 3 | Shapes — Rectangle | [x] Done | Drag-to-draw, resize handles, fill/stroke |
| 4 | Shapes — Circle | [x] Done | Ellipse via Konva, drag-to-draw, resize handles, fill/stroke |
| 5 | Shapes — Line | [x] Done | Line via Konva, drag-to-draw, configurable stroke |
| 6 | Connectors (lines/arrows between objects) | [x] Done | Connector element with curved routing, arrowheads (none/arrow/diamond), dash styles, endpoint snapping to shapes, reactive position tracking, text labels with formatting, composable toolbar |
| 7 | Standalone text elements | [x] Done | Text element with double-click inline editing, configurable font size |
| 8 | Frames (group + organize areas) | [x] Done | Frame element with title label, bg/border color, solid/dashed/none border, hide/show toggle, child containment on move |
| 9 | Transforms — Move | [x] Done | Drag via Konva + Yjs transact |
| 10 | Transforms — Resize | [x] Done | 8-point handles, min size enforcement |
| 11 | Transforms — Rotate | [x] Done | Rotation zones outside corners, center-pivot, Shift-snap to 15°, custom cursor with Lucide icons |
| 12 | Selection — Single select | [x] Done | Click to select, blue highlight ring |
| 13 | Selection — Multi-select (shift-click) | [x] Done | Shift-click toggles elements in/out of selection set |
| 14 | Selection — Drag-to-select (marquee) | [x] Done | Drag on empty canvas draws selection rectangle, selects intersecting elements |
| 15 | Operations — Delete | [x] Done | Delete/Backspace key, toolbar trash button |
| 16 | Operations — Duplicate | [x] Done | Ctrl/Cmd+D, toolbar button, +20px offset |
| 17 | Operations — Copy/paste | [x] Done | Ctrl/Cmd+C/V, clipboard API, viewport-centered paste, plain text creates sticky note |
| 18 | Presentation mode | [x] Done | Slide deck from frames, Yjs slideOrder, camera animation, collaborative following via presence |

---

## Core Whiteboard — Real-Time Collaboration

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Multiplayer cursors with names | [x] Done | Yjs presence map, colored SVG cursors |
| 2 | Object sync (instant for all users) | [x] Done | Yjs shared types, binary WebSocket sync |
| 3 | Presence (who's currently online) | [x] Done | Peer count in header bar |
| 4 | Conflict handling (LWW via Yjs) | [x] Done | Yjs CRDT handles merges automatically |
| 5 | Resilience (disconnect/reconnect) | [x] Done | Exponential backoff (1s-30s) with jitter, same Y.Doc across reconnects, "reconnecting" UI state |
| 6 | Persistence (board survives reload) | [x] Done | Yjs state serialized to PostgreSQL every 30s |

---

## Core Whiteboard — Performance Targets

| # | Metric | Target | Status | Notes |
|---|--------|--------|--------|-------|
| 1 | Frame rate during pan/zoom | 60 FPS | [x] Infra done | FPS monitoring in perf-probe, budget in perf checks, viewport culling, and RAF-batched Canvas2D renderer snapshot sync with batched live drag overrides |
| 2 | Object sync latency | <100ms | [x] Infra done | WS benchmark measures p50/p95/p99; high-frequency drag/resize/rotate writes are RAF-batched on frontend |
| 3 | Cursor sync latency | <50ms | [x] Infra done | Perf probe round-trip measurement |
| 4 | Object capacity (500+ objects) | 500+ | [x] Infra done | WS benchmark creates 500 objects |
| 5 | Concurrent users | 5+ | [x] Infra done | 5 seeded perf users, Playwright multi-session test |
| 6 | Input to render latency | p95 <= 16.7ms | [x] Infra done | `inputToRenderMs` now enforced in frontend perf budget checks |
| 7 | Long frame budget | <=120/min | [x] Infra done | `canvasLongFramesPerMinute` enforced in `perf-check.ts` and frontend perf spec; 2026-02-22 canvas architecture pass removed the persistent soft-budget warning in local perf CI |

---

## AI Board Agent

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | OpenAI integration + function calling | [x] Done | LangChain.js + OpenAI GPT-5.1, LangSmith tracing |
| 2 | Tool: `createStickyNote(text, x, y, color)` | [x] Done | Yjs transact, random color default |
| 3 | Tool: `createShape(type, x, y, w, h, color)` | [x] Done | rectangle, circle, line |
| 4 | Tool: `createFrame(title, x, y, w, h)` | [x] Done | |
| 5 | Tool: `createConnector(fromId, toId, style)` | [x] Done | curved |
| 6 | Tool: `moveObject(objectId, x, y)` | [x] Done | |
| 7 | Tool: `resizeObject(objectId, w, h)` | [x] Done | |
| 8 | Tool: `updateText(objectId, newText)` | [x] Done | |
| 9 | Tool: `changeColor(objectId, color)` | [x] Done | |
| 10 | Tool: `getBoardState()` | [x] Done | |
| 11 | Chat UI panel (send commands, see responses) | [x] Done | Slide-out panel with message history, tool call badges |
| 12 | Creation commands (6+ types) | [x] Done | sticky-note, rect, circle, line, text, frame, connector via batch tools |
| 13 | Manipulation commands | [x] Done | move, resize, color, text, delete + batchModifyElements |
| 14 | Layout commands (grid, spacing) | [x] Done | batchCreateElements with positional math in system prompt |
| 15 | Complex commands (templates: SWOT, retro, journey map) | [x] Done | System prompt instructs template creation with frames + sticky notes |
| 16 | Response latency < 2s for single-step | [~] Partial | p95 3268ms exceeds 2000ms budget because complex template commands (SWOT, diagrams, column layouts) are optimized into single atomic tool calls. Simple single-object commands (create, move, recolor) complete in 1-2s within budget. See `docs/ai-development-log.md` for full analysis. |
| 17 | Conversation context (multi-turn) | [x] Done | History passed via WS, capped at 10 messages, system prompt supports follow-ups |
| 18 | AI perf testing (LangSmith traces) | [x] Done | `bun run ai:perf-check` validates latency p95/p99 against budgets |
| 19 | AI Vision: image-to-board recreation | [x] Done | Upload/paste/drop image, vision model recreates on canvas |

---

## Infrastructure & Security

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | WebSocket auth (validate session on upgrade) | [x] Done | Session validated in WS `open` handler via `auth.api.getSession()`, closes with 4401 if unauthorized |
| 2 | Input validation / XSS sanitization | [x] Done | TypeBox schemas in shared package, HTML tag stripping, length limits enforced on backend API (board CRUD) and frontend (presence, element text, board forms) |
| 3 | CORS configuration | [x] Done | Configured in Elysia server |
| 4 | HTTPS/WSS in production | [x] Done | Railway provides TLS, app deployed |
| 5 | Database schema + migrations | [x] Done | Drizzle ORM, 2 migrations applied |
| 6 | Board CRUD API | [x] Done | List, create, rename (PATCH), delete with ownership enforcement |
| 7 | Dashboard page (board management UI) | [x] Done | `/dashboard` with board grid, create dialog, rename dialog, delete confirmation |
| 8 | Performance benchmarking (WS) | [x] Done | `ws-benchmark.ts`, JSONL artifact output |
| 9 | Performance benchmarking (frontend) | [x] Done | Playwright perf spec, FPS/latency collection |
| 10 | Performance budget enforcement | [x] Done | `perf-check.ts` validates against `performance-budgets.json` |
| 11 | CI/CD pipeline | [x] Done | GitHub Actions: migrations, perf benchmarks, budget check |
| 12 | Docker builds | [x] Done | Separate Dockerfiles for backend + frontend |

---

## Submission Deliverables

| # | Deliverable | Status | Notes |
|---|-------------|--------|-------|
| 1 | GitHub repository with setup guide | [x] Done | README with architecture diagram, tech stack, env vars, setup guide, deployed URL |
| 2 | Pre-Search document | [x] Done | `docs/pre-search.md` |
| 3 | AI Development Log (1-page) | [x] Done | `docs/ai-development-log.md` -- tools/workflow, MCP, prompts, code analysis, learnings |
| 4 | AI Cost Analysis (dev spend + projections) | [x] Done | `docs/ai-cost-analysis.md` + `bun run ai:cost-analysis` (LangSmith), per-model projections with gpt-5.1 as production model |
| 5 | Demo Video (3-5 min) | [x] Done | [Loom Recording](https://www.loom.com/share/9727c803804843b4bd51ddd33b177a05) |
| 6 | Deployed application (publicly accessible) | [x] Done | Railway, `gsgarces.dev` (frontend) + `api.gsgarces.dev` (backend) |
| 7 | Social Post (X or LinkedIn) | [x] Done | [X Post](https://x.com/gsgarces/status/2024997613876003000) |

---

## Status

All layers (0-4) are complete. All submission deliverables are done.
