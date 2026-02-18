# Memory Index

Last updated: 2026-02-18

Read this first before looking for specific memories. If it's not listed here, it's not stored.

## How This Works

- AI agents read this index to find relevant knowledge without loading everything.
- When adding a memory file, add a one-line entry here with date.
- When archiving, remove the entry and add a summary under Archived.
- Keep this file under 50 entries. Archive completed work aggressively.

## Size Limits

- Individual files: soft limit 10KB (consolidate), hard limit 25KB (archive and summarize).
- This index: keep under 50 entries.

---

## Decisions

- `docs/memory/decisions.md` — Architecture Decision Records (ADR-001 through ADR-010). Covers CRDT choice, rendering, auth, deployment, AI flow, data layer, UI framework, Zustand for canvas state, WS message buffering, and connector architecture. (2026-02-18)

## Known Issues

- `docs/memory/known-issues.md` — Active issues: XSS sanitization missing, Yjs memory growth risk, persistence race condition. Resolved: WS auth, reconnect resilience, board loading race conditions. (2026-02-17)

## Research Findings

_(none yet)_

## Active Plans

- See `docs/build-checklist.md` for the full implementation tracker with dependency graph.

## Archived

_(none yet)_
