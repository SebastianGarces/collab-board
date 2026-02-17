# Agent Instructions

## Local Environment Assumptions

The developer always has the backend, frontend, and database running locally. **Do NOT** attempt to:

- Start, stop, restart, or kill dev servers (`bun run dev`, `bun run dev:backend`, `bun run dev:frontend`)
- Start, stop, or manage Docker containers (`docker compose up`, `docker compose down`, `db:up`, `db:recreate`)
- Kill processes on ports (e.g. `kill`, `lsof` to free ports)

All scripts (perf benchmarks, seed scripts, migrations, etc.) assume services are already running and available. If a command fails due to a missing service, report the issue and let the developer handle it.

## Performance Verification During Changes

When making code changes, run performance checks incrementally for the area you changed. Do not wait until the very end of a large task.

- Backend real-time/collab changes (`apps/backend/src/collab/**`, websocket sync, room manager, protocol):
  - Run `bun run perf:ws:ci`
- Frontend canvas/realtime/client sync changes (`apps/frontend/src/app/canvas/**`, `apps/frontend/src/components/canvas/**`, `apps/frontend/src/lib/collab.ts`, perf test harness):
  - Run `bun run perf:frontend:ci`
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

## Required Behavior

- Prefer running the smallest relevant perf command after each meaningful batch of edits.
- If a perf check fails, fix the regression before continuing with additional feature work.
- If a required perf check cannot run locally (environment/tooling issue), explicitly report:
  - which command failed
  - why it failed
  - what remains to be verified
- For CI-impacting changes, ensure the final state still passes `bun run perf:check` at minimum.
