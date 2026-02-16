# CollabBoard Pre-Search Document

**Project**: CollabBoard -- Real-Time Collaborative Whiteboard with AI Agent  
**Date**: February 16, 2026  
**Author**: Solo Developer  
**Methodology**: AI-First Development (Cursor, Claude)

---

## Phase 1: Define Your Constraints

### 1. Scale and Load Profile

- **Launch**: 5-20 concurrent users (evaluators, demos)
- **6 months**: ~50 users
- **Traffic pattern**: Spiky, demo-driven. Load peaks around presentations and evaluations, minimal baseline traffic.
- **Real-time requirements**: Yes -- WebSocket connections for live cursor sync, object sync, and AI command streaming. Every connected client maintains a persistent WebSocket.
- **Cold start tolerance**: Under 1 second. Board list preloaded on login (Next.js Link prefetching), board state hydrated from persisted Yjs snapshot on room join.

### 2. Budget and Cost Ceiling

- **Demo period**: Free tier only (Railway free plan for hosting, PostgreSQL included).
- **Production projection** (documented as real product):
  - Hosting: $0-20/month (Railway Hobby, scales with usage)
  - Database: $0-10/month (Railway Postgres, included in plan)
  - AI API (OpenAI): Variable -- estimated $5-50/month depending on user volume (see AI Cost Analysis deliverable)
- **Trade money for time**: Using managed services (Railway, Better Auth) to avoid ops overhead as a solo developer.

### 3. Time to Ship

- **MVP**: 24 hours (collaborative infrastructure: sync, cursors, sticky notes, shapes)
- **Full features**: Friday (4 days -- all board features, AI agent, testing)
- **Polish**: Sunday (deployment, documentation, demo video)
- **Priority**: Balanced -- reasonable architecture without over-engineering. Clean enough for portfolio but shipping fast enough to hit deadlines.
- **Iteration cadence**: Daily pushes, continuous testing with multiple browser windows.

### 4. Compliance and Regulatory Needs

Documented with enterprise-grade best practices in mind:

- **GDPR**: User data minimization, right to deletion (board cleanup, account deletion). Cookie consent for auth sessions.
- **SOC 2**: Audit logging for board access and modifications. Encrypted data at rest (PostgreSQL) and in transit (TLS/WSS).
- **Data residency**: Railway region selection (US default). Document as configurable for multi-region in production.
- **HIPAA**: Not applicable for this use case.
- **MVP implementation**: Basic auth, HTTPS enforcement, secure WebSocket (WSS). Full compliance is documented, partially implemented.

### 5. Team and Skill Constraints

- **Team**: Solo developer
- **Strengths**: TypeScript, React, WebSockets, Node/Bun ecosystem
- **Learning areas**: CRDTs (Yjs specifically), canvas rendering (Konva.js)
- **Approach**: AI-first development (Cursor, Claude) to accelerate unfamiliar areas. Lean on Yjs abstractions rather than implementing raw CRDTs.

---

## Phase 2: Architecture Discovery

### 6. Hosting and Deployment

- **Platform**: Railway
  - Supports long-lived WebSocket connections (critical for real-time sync)
  - Includes PostgreSQL as a service
  - Auto-deploy from GitHub (manual for MVP, auto later)
  - Free tier sufficient for demo
- **Architecture**: Two Railway services
  - `backend`: Elysia (Bun) -- REST + WebSocket on single port
  - `frontend`: Next.js (standalone build)
- **CI/CD**: Manual deploys for MVP (`railway up` / git push)
- **Scaling characteristics**: Railway handles horizontal scaling. For production, WebSocket connections would need sticky sessions or a pub/sub layer (Redis) for multi-instance sync.

### 7. Authentication and Authorization

- **Library**: Better Auth (TypeScript-first, Drizzle adapter)
- **Methods**: Email/password sign-up/sign-in. Demo accounts seeded for evaluators.
- **Session management**: Cookie-based sessions via Better Auth
- **Authorization model**:
  - Board ownership (creator has full control)
  - Shared access via board links (anyone with the link can collaborate)
  - Future: RBAC (viewer, editor, admin roles per board)
- **WebSocket auth**: Validate session token on WebSocket upgrade (currently a gap to fix)
- **Multi-tenancy**: User-scoped boards. Each board is a separate Yjs room.

### 8. Database and Data Layer

**Data Flow Diagram:**

```
  [User A Browser] <--Yjs sync--> [WebSocket Handler] <--> [Yjs Document (In Memory)]
  [User B Browser] <--Yjs sync--> [WebSocket Handler]           |
                                                          [Room Manager]
                                                                |
                                              [Periodic snapshots] --> [PostgreSQL]
                                              [Hydrate on room load] <-- [PostgreSQL]
```

- **Database**: PostgreSQL 16 via Railway
- **ORM**: Drizzle ORM (type-safe, lightweight)
- **Board content**: Yjs document is the single source of truth
  - Stored in Yjs shared types: `Y.Map` for elements, `Y.Map` for presence
  - Persisted as binary snapshots to PostgreSQL (`boards` table with a `yjs_state bytea` column)
  - Hydrated from snapshot when room loads, then live in-memory
- **Board metadata**: Lightweight PostgreSQL table
  - `boards(id, name, owner_id, created_at, updated_at, element_count)`
  - Used for: board listing, ownership checks, free-tier limits, dashboard
- **Auth tables**: Managed by Better Auth/Drizzle (user, session, account, verification)
- **Read/write ratio**: Heavy reads (cursor positions, board state), moderate writes (object creation/edits)
- **Caching**: Yjs documents cached in-memory per room. No external cache layer needed at this scale.

### 9. Backend/API Architecture

- **Framework**: Elysia (Bun runtime) -- single server handling both REST and WebSocket
- **API style**: REST for standard endpoints, WebSocket for real-time
- **Endpoints**:
  - `POST /api/auth/*` -- Better Auth routes (login, signup, session)
  - `GET /api/me` -- Session info
  - `GET /api/boards` -- List user's boards
  - `POST /api/boards` -- Create board
  - `WS /ws/collab/:roomId` -- Yjs sync + presence + AI commands
- **AI commands**: Sent as WebSocket messages on the collab channel. Server processes via OpenAI function calling, streams results back, and applies tool calls to the Yjs document. All users see changes in real-time through normal Yjs sync.
- **Background jobs**: None needed at MVP. Periodic Yjs snapshot persistence can run on a timer within the server process.
- **Monolith**: Single backend service. Microservices not warranted at this scale.

### 10. Frontend Framework and Rendering

- **Framework**: Next.js 16 (App Router)
- **Rendering strategy**: Hybrid
  - SSR: Login page, board dashboard/listing (SEO-friendly, fast initial load)
  - Client-side: Canvas page (real-time, no SSR benefit)
- **Canvas rendering**: Konva.js with `react-konva`
  - Canvas-based (handles 500+ objects at 60fps)
  - Built-in: shapes, text, transforms, drag, resize, rotate, hit detection
  - React bindings for declarative rendering
  - Layer system for separating background, objects, selection, cursors
- **Overlay UI**: shadcn/ui + Tailwind CSS
  - shadcn/ui for all non-canvas UI: toolbars, panels, dialogs, menus, AI chat, presence indicators
  - Tailwind CSS as the styling foundation (required by shadcn)
  - Radix UI primitives under the hood (accessible, composable)
  - Components live in `src/components/ui/` (shadcn default) -- copy-paste ownership, fully customizable
  - Dark theme by default (matches the existing dark canvas aesthetic)
  - Key shadcn components anticipated: Button, Dialog, Popover, DropdownMenu, Tooltip, Sheet (side panels), Input, Textarea, Badge, Avatar, Separator, ScrollArea, Command (for AI chat)
  - Overlay UI is positioned absolutely over the Konva canvas -- canvas handles board interaction, shadcn handles application chrome
- **State management**: Yjs shared types as the source of truth, React state derived from Yjs observers
- **Offline/PWA**: Not planned for MVP. Yjs supports offline-first by design (syncs on reconnect), but no service worker.

### 11. Third-Party Integrations

- **Yjs** -- CRDT library -- Free (MIT) -- Low lock-in (protocol is open)
- **Better Auth** -- Authentication -- Free (MIT) -- Medium lock-in (wraps your DB)
- **Konva.js** -- Canvas rendering -- Free (MIT) -- Medium lock-in (rendering tied to API)
- **OpenAI** -- AI agent (GPT-4o) -- Pay-per-token -- Medium lock-in (can swap providers)
- **Railway** -- Hosting + Postgres -- Free tier, then usage-based -- Low lock-in (standard containers)
- **Drizzle** -- ORM -- Free (MIT) -- Low lock-in (generates SQL)
- **shadcn/ui** -- UI components -- Free (MIT) -- No lock-in (copy-paste, you own it)
- **Tailwind CSS** -- Utility CSS -- Free (MIT) -- Low lock-in (standard CSS underneath)

**Rate limits to watch**: OpenAI API (TPM/RPM limits on free tier), Railway free tier (500 hours/month execution)

**Fallback plan**: OpenAI can be swapped for Anthropic Claude (similar function calling API). Railway can be replaced with Render or Fly.io.

---

## Phase 3: Post-Stack Refinement

### 12. Security Vulnerabilities

**Must implement for MVP:**

- WebSocket authentication: Validate session token on WS upgrade handshake (currently missing)
- CORS: Already configured, verify production origins
- Input validation: Sanitize text content in sticky notes (XSS prevention)
- HTTPS/WSS: Enforce TLS in production (Railway provides this)

**Document for production:**

- Rate limiting: Limit AI commands per user (prevent API cost abuse), limit WS message frequency
- CSP headers: Prevent script injection on the canvas page
- Dependency auditing: `bun audit` in CI pipeline
- Session expiry: Configure Better Auth session TTL
- Board access control: Verify user has permission before joining a room's WebSocket

**Known pitfalls for this stack:**

- Yjs documents in memory can grow unbounded if not garbage-collected
- WebSocket connections without auth allow unauthorized board access
- Better Auth secret must be strong (32+ chars) and not committed to repo

### 13. File Structure and Project Organization

Monorepo structure:

```
collab-board/
  apps/
    backend/src/
      auth/           # Better Auth config + plugin
      collab/         # WebSocket handler, room manager, protocol
      db/             # Drizzle schema + client
      ai/             # AI agent, tool definitions, OpenAI client
      boards/         # Board CRUD routes
    frontend/src/
      app/            # Next.js App Router pages
        canvas/       # Canvas page (Konva rendering)
        login/        # Auth pages
        dashboard/    # Board listing/management
      lib/            # Auth client, collab client, utilities
      components/     # Reusable UI components
        canvas/       # Canvas-specific components (sticky, shape, etc.)
        ui/           # shadcn/ui generated components (Button, Dialog, etc.)
        board/        # Board overlay UI (toolbar, layers panel, AI chat)
  packages/
    shared/src/       # Shared types (auth, collab, board element types)
  docs/               # Architecture docs, pre-search, AI dev log
```

- Add shared packages only if type definitions grow complex enough to warrant separation.
- Feature modules within apps (e.g., `ai/`, `boards/`) keep concerns separated without over-abstracting.

### 14. Naming Conventions and Code Style

- **Files**: kebab-case (`room-manager.ts`, `auth-client.ts`)
- **Components**: PascalCase (`StickyNote.tsx`, `BoardCanvas.tsx`)
- **Functions/variables**: camelCase
- **Types/interfaces**: PascalCase
- **Constants**: SCREAMING_SNAKE_CASE for true constants, camelCase for config
- **CSS**: Tailwind CSS utility classes + shadcn/ui `cn()` helper for conditional classes. Existing vanilla CSS in `globals.css` will be migrated to Tailwind as components are rebuilt with shadcn.

### 15. Testing Strategy

- **Unit tests**: Vitest for CRDT/sync logic, board operations, AI tool execution
  - Test Yjs document operations (create, merge, conflict resolution)
  - Test AI tool schema validation and execution
  - Test board metadata operations
- **Integration tests**: Test WebSocket connections, auth flows, Yjs sync between multiple clients
- **E2E tests**: Playwright for multi-browser collaborative scenarios
  - 2 users editing simultaneously
  - Refresh mid-edit (persistence check)
  - Rapid creation/movement (sync performance)
  - Network throttling / disconnect recovery
  - 5+ concurrent users
- **Coverage target**: Core sync logic well-tested, UI tested via e2e. No strict percentage target for MVP.

### 16. Recommended Tooling and DX

- **Package manager**: Bun (fast, built-in test runner)
- **TypeScript**: Strict mode enabled
- **Linting**: Minimal -- TypeScript strict mode for MVP. Consider Biome later for its speed with Bun.
- **Debugging**: Browser DevTools for canvas/network, Yjs debug logging, Railway logs for server
- **Dev workflow**: `bun run dev` starts both apps. Test with 2+ browser windows side by side.
- **Monitoring** (deferred): Leaning toward Sentry (error tracking) + Grafana (metrics). Document the plan, implement post-MVP.

---

## Architecture Summary

**System Architecture:**

```
  +--------------------------------------------------+
  |              Client (Browser)                     |
  |                                                   |
  |  [Next.js App]                                    |
  |    |-- [shadcn/ui Overlay] --+                    |
  |    |-- [Konva.js Canvas] <---+                    |
  |    |-- [Yjs Client Doc] <-- WebSocket --> ...     |
  |    |-- [Better Auth Client] <-- HTTP --> ...      |
  +--------------------------------------------------+
                    |                    |
                WebSocket              HTTP
                    |                    |
  +--------------------------------------------------+
  |            Railway (Backend)                      |
  |                                                   |
  |  [Elysia Server]                                  |
  |    |-- [WebSocket Handler]                        |
  |    |     |-- [Room Manager] <-> [Yjs Server Docs] |
  |    |     |-- [AI Agent] <-> [OpenAI GPT-4o]       |
  |    |-- [Better Auth Server]                       |
  +--------------------------------------------------+
                         |
                    PostgreSQL
                         |
  +--------------------------------------------------+
  |           Railway (PostgreSQL)                    |
  |                                                   |
  |  - Auth tables (user, session, account)           |
  |  - Board metadata (id, name, owner_id, ...)      |
  |  - Yjs snapshots (binary board state)             |
  +--------------------------------------------------+
```

## Key Decisions Summary

- **CRDT approach**: Yjs (state-based CRDT library) over WebSocket, not a custom implementation. Aligns with the LWW Map composition pattern from the [CRDT article](https://jakelazaroff.com/words/an-interactive-intro-to-crdts/) but uses Yjs's optimized internals.
- **Single source of truth**: Yjs document for board content, PostgreSQL for metadata only
- **Rendering**: Konva.js (Canvas-based, 60fps, built-in transforms) + shadcn/ui (Tailwind-based overlay UI for toolbars, panels, AI chat)
- **AI flow**: Commands over WebSocket, OpenAI function calling, results applied to Yjs doc server-side
- **Deployment**: Railway (WebSocket-friendly, Postgres included, free tier)
- **Auth**: Better Auth with email/password, seeded demo accounts
- **Testing**: Full pyramid (unit + integration + e2e with Playwright)

## Build Priority Order

1. WebSocket auth enforcement (security gap)
2. Konva.js canvas with pan/zoom
3. Board element types in Yjs (sticky notes, shapes)
4. Real-time object sync and multiplayer cursors
5. Board persistence (Yjs snapshots to PostgreSQL)
6. Board dashboard (list, create, delete boards)
7. Selection, transforms, delete/duplicate
8. Frames, connectors, text elements
9. AI agent (basic single-step commands)
10. AI agent (complex multi-step templates)
11. Testing suite
12. Deployment and polish
