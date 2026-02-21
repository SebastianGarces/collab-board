# Agent Instructions

## Immutable Rules

These rules are never violated. If a plan or implementation breaks one, stop and flag it.

1. **Auth before everything.** All HTTP routes require Better Auth session validation. WebSocket upgrade must validate auth token. No unauthenticated access.
2. **Yjs doc is the single source of truth for board content.** PostgreSQL stores metadata and snapshots only. Never read/write board element state directly to PostgreSQL.
3. **AI mutations flow through the server.** AI commands arrive via WebSocket, execute server-side against the Yjs doc, and sync to all clients. The client never applies AI mutations directly.
4. **Performance budgets are not optional.** If a change causes a perf regression, fix it before merging. The budgets in `docs/performance-budgets.json` are enforced in CI.

## Current Milestone

**Phase:** Core features + AI Agent
**Next goal:** See dependency graph in `docs/build-checklist.md`
**Tracker:** `docs/build-checklist.md`

## Memory Protocol

**Before starting work:** Read `docs/memory/INDEX.md` to find relevant context from previous sessions.

**During work:** If you discover something valuable (a pattern, a gotcha, a decision), note it for the user to add or update the memory files directly.

**After completing a feature:**
1. Update `docs/memory/INDEX.md` with any new entries
2. Update `docs/memory/decisions.md` if architectural choices were made
3. Update `docs/memory/known-issues.md` if bugs or workarounds were found
4. Update `docs/conventions.md` if new patterns were established
5. Update `docs/build-checklist.md` to mark completed items

## Local Environment Assumptions

The developer always has the backend, frontend, and database running locally. **Do NOT** attempt to:

- Start, stop, restart, or kill dev servers (`bun run dev`, `bun run dev:backend`, `bun run dev:frontend`)
- Start, stop, or manage Docker containers (`docker compose up`, `docker compose down`, `db:up`, `db:recreate`)
- Kill processes on ports (e.g. `kill`, `lsof` to free ports)

All scripts (perf benchmarks, seed scripts, migrations, etc.) assume services are already running and available. If a command fails due to a missing service, report the issue and let the developer handle it.

## Performance Verification During Changes

When making code changes, run performance checks incrementally for the area you changed. Do not wait until the very end of a large task.

**IMPORTANT:** Do NOT run `bun run perf:frontend:ci` in a sandboxed environment. The frontend performance tests require full system access (browser automation, display server, etc.) and will fail in restricted environments. If you need to run performance checks but are in a sandbox, request `required_permissions: ["all"]` or skip the frontend perf check and report it to the developer.

- Backend real-time/collab changes (`apps/backend/src/collab/**`, websocket sync, room manager, protocol):
  - Run `bun run perf:ws:ci`
- Frontend canvas/realtime/client sync changes (`apps/frontend/src/app/canvas/**`, `apps/frontend/src/components/canvas/**`, `apps/frontend/src/lib/collab.ts`, perf test harness):
  - Run `bun run perf:frontend:ci` (NOT in sandbox - see above)
- Shared budget/metrics/script/workflow changes (`docs/performance-budgets.json`, `scripts/perf-*.ts`, `.github/workflows/performance.yml`, root/package scripts):
  - Run `bun run perf:check`
- Cross-cutting changes touching both frontend and backend realtime paths:
  - Run `bun run perf:ws:ci`, then `bun run perf:frontend:ci`, then `bun run perf:check`

## Build Checklist Maintenance

The file `docs/build-checklist.md` tracks what has been implemented and what remains against the project spec. Keep it up to date:

- After completing a feature or task, mark the corresponding checklist item(s) as `[x] Done` and update the **Notes** column if relevant.
- If a partially-done item (`[~]`) becomes fully complete, change it to `[x] Done`.
- If new work is discovered or scope changes, add it to the appropriate table and dependency layer.
- Do **not** remove items from the checklist — only update their status.

## AI Trace Review

When the user says **"review this trace `<traceId>`"** (or similar phrasing referencing a Langfuse trace ID):

1. Run `bun run ai:trace-review <traceId>` to fetch the full trace from Langfuse.
2. Read the output from `artifacts/ai-trace-review.md`.
3. Analyze the trace for:
   - **System prompt effectiveness:** Did the agent follow instructions? Were there unnecessary clarification questions? Did it use reasonable defaults as instructed?
   - **Tool usage efficiency:** Batch vs single calls, unnecessary `getBoardState` calls, correct tool selection for the task.
   - **Response quality:** Concise? Accurate? Helpful? Did it over-explain coordinates or repeat tool details?
   - **Token waste:** Redundant content in messages, oversized tool outputs, system prompt bloat.
   - **Multi-step behavior:** Was it necessary? Could it have been done in fewer steps?
4. Present findings and suggest specific system prompt improvements with before/after diffs when applicable.

## UI Conventions

- **Clickable elements:** When adding or modifying elements that are clickable (buttons, links, interactive controls), always add `cursor-pointer` so the pointer cursor is shown on hover. This applies to both native `<button>` elements and button-like components (e.g. `Button` from shadcn).

## Required Behavior

- Prefer running the smallest relevant perf command after each meaningful batch of edits.
- If a perf check fails, fix the regression before continuing with additional feature work.
- If a required perf check cannot run locally (environment/tooling issue), explicitly report:
  - which command failed
  - why it failed
  - what remains to be verified
- For CI-impacting changes, ensure the final state still passes `bun run perf:check` at minimum.
