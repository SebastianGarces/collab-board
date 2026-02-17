# CollabBoard Build Checklist

**Last updated**: February 17, 2026

This checklist tracks what has been implemented against the full spec in `collab-board.md`, informed by the architecture decisions in `pre-search.md`. Items are organized by dependency layer so you can work top-to-bottom without getting blocked.

---

## Status Legend

- [x] Done
- [ ] Not started
- [~] Partially done

---

## Dependency Graph

```
Layer 0 (no blockers - can start now)
├── WS auth enforcement
├── Disconnect/reconnect resilience
├── Dashboard page (board list, create, delete)
├── Circle shape
├── Line shape
├── Standalone text elements
├── Sticky note color picker UI
├── Multi-select (shift-click + marquee)
├── Rotate transform
└── Input validation / XSS sanitization

Layer 1 (depends on Layer 0)
├── Connectors ← needs shapes to connect to
├── Frames ← benefits from multi-select for grouping
├── Duplicate operation ← benefits from multi-select
└── Copy/paste ← benefits from multi-select

Layer 2 (depends on Layer 1)
├── AI Agent: tool schema + OpenAI integration ← needs board features to manipulate
└── AI Agent: chat UI panel ← needs tool integration

Layer 3 (depends on Layer 2)
├── AI Agent: complex multi-step commands ← needs basic AI working
└── AI Agent: layout commands ← needs basic AI + frames

Layer 4 (final — depends on everything above)
├── AI Development Log
├── AI Cost Analysis
├── Demo Video (3-5 min)
├── Deployed application (public URL)
└── Social Post (X or LinkedIn)
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
| 6 | Connectors (lines/arrows between objects) | [ ] Not done | No connector type, no endpoint snapping logic |
| 7 | Standalone text elements | [x] Done | Text element with double-click inline editing, configurable font size |
| 8 | Frames (group + organize areas) | [ ] Not done | No frame type, no child containment logic |
| 9 | Transforms — Move | [x] Done | Drag via Konva + Yjs transact |
| 10 | Transforms — Resize | [x] Done | 8-point handles, min size enforcement |
| 11 | Transforms — Rotate | [x] Done | Rotation zones outside corners, center-pivot, Shift-snap to 15°, custom cursor with Lucide icons |
| 12 | Selection — Single select | [x] Done | Click to select, blue highlight ring |
| 13 | Selection — Multi-select (shift-click) | [x] Done | Shift-click toggles elements in/out of selection set |
| 14 | Selection — Drag-to-select (marquee) | [x] Done | Drag on empty canvas draws selection rectangle, selects intersecting elements |
| 15 | Operations — Delete | [x] Done | Delete/Backspace key, toolbar trash button |
| 16 | Operations — Duplicate | [x] Done | Ctrl/Cmd+D, toolbar button, +20px offset |
| 17 | Operations — Copy/paste | [x] Done | Ctrl/Cmd+C/V, clipboard API, viewport-centered paste, plain text creates sticky note |

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
| 1 | Frame rate during pan/zoom | 60 FPS | [x] Infra done | FPS monitoring in perf-probe, budget in perf checks |
| 2 | Object sync latency | <100ms | [x] Infra done | WS benchmark measures p50/p95/p99 |
| 3 | Cursor sync latency | <50ms | [x] Infra done | Perf probe round-trip measurement |
| 4 | Object capacity (500+ objects) | 500+ | [x] Infra done | WS benchmark creates 500 objects |
| 5 | Concurrent users | 5+ | [x] Infra done | 5 seeded perf users, Playwright multi-session test |

---

## AI Board Agent

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | OpenAI integration + function calling | [ ] Not done | No `ai/` module in backend |
| 2 | Tool: `createStickyNote(text, x, y, color)` | [ ] Not done | |
| 3 | Tool: `createShape(type, x, y, w, h, color)` | [ ] Not done | |
| 4 | Tool: `createFrame(title, x, y, w, h)` | [ ] Not done | Depends on Frame element type |
| 5 | Tool: `createConnector(fromId, toId, style)` | [ ] Not done | Depends on Connector element type |
| 6 | Tool: `moveObject(objectId, x, y)` | [ ] Not done | |
| 7 | Tool: `resizeObject(objectId, w, h)` | [ ] Not done | |
| 8 | Tool: `updateText(objectId, newText)` | [ ] Not done | |
| 9 | Tool: `changeColor(objectId, color)` | [ ] Not done | |
| 10 | Tool: `getBoardState()` | [ ] Not done | |
| 11 | Chat UI panel (send commands, see responses) | [ ] Not done | No AI chat component |
| 12 | Creation commands (6+ types) | [ ] Not done | |
| 13 | Manipulation commands | [ ] Not done | |
| 14 | Layout commands (grid, spacing) | [ ] Not done | |
| 15 | Complex commands (templates: SWOT, retro, journey map) | [ ] Not done | |
| 16 | Response latency < 2s for single-step | [ ] Not done | |

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
| 1 | GitHub repository with setup guide | [~] Partial | README exists, could use more detail |
| 2 | Pre-Search document | [x] Done | `docs/pre-search.md` |
| 3 | AI Development Log (1-page) | [ ] Not done | |
| 4 | AI Cost Analysis (dev spend + projections) | [ ] Not done | |
| 5 | Demo Video (3-5 min) | [ ] Not done | |
| 6 | Deployed application (publicly accessible) | [x] Done | Railway, auto-deploy on push to main |
| 7 | Social Post (X or LinkedIn) | [ ] Not done | |

---

## Recommended Build Order

Based on the dependency graph and deadlines, here is the suggested order for remaining work:

### Sprint 1: MVP Polish + Core Gaps (highest priority)
1. **Disconnect/reconnect resilience** — add retry with exponential backoff in `collab.ts`
2. **Dashboard page** — board listing, create new board, delete board
3. **Board CRUD completion** — delete endpoint, ownership enforcement

### Sprint 2: Remaining Board Features (Layer 0)
5. **Circle shape** — add to `ElementType`, create component, add to toolbar
6. **Line shape** — add to `ElementType`, create component, add to toolbar
7. **Standalone text elements** — new element type with inline editing
8. **Sticky note color picker** — popover UI to change color after creation
9. **Multi-select** — shift-click for additive selection, marquee rubber-band
10. **Rotate transform** — rotation handle + rotation property on elements
11. **Input validation** — sanitize text content for XSS prevention
12. **WebSocket auth** — validate session cookie/token on WS upgrade

### Sprint 3: Compound Features (Layer 1)
13. **Connectors** — line/arrow elements that snap to shape endpoints
14. **Frames** — container element type with title, child containment
15. **Duplicate operation** — Ctrl+D / toolbar, works with multi-select
16. **Copy/paste** — Ctrl+C/V with clipboard, works with multi-select

### Sprint 4: AI Agent (Layers 2-3)
17. **AI backend** — OpenAI client, tool definitions, function calling pipeline
18. **AI tool implementations** — createStickyNote, createShape, moveObject, etc.
19. **AI chat UI** — side panel or command bar with shadcn Sheet/Command
20. **AI basic commands** — single-step creation and manipulation
21. **AI layout commands** — grid arrangement, spacing
22. **AI complex commands** — SWOT template, retro board, journey map

### Sprint 5: Polish + Deliverables (Layer 4)
22. **AI Development Log** — document tools, prompts, code analysis
23. **AI Cost Analysis** — dev spend tracking + production projections
24. **Demo Video** — 3-5 min recording covering collab + AI + architecture
25. **Verify deployment** — confirm public URL supports 5+ concurrent users
26. **Social Post** — share on X or LinkedIn tagging @GauntletAI
