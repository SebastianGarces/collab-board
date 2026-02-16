# Performance Budgets

This file defines the canonical performance constraints for CollabBoard. Automated benchmarks and CI gates must read from `docs/performance-budgets.json` and enforce these targets.

## Budget Scope

- **Environment baseline**:
  - Backend perf runs on local dev or CI Linux runner.
  - Frontend perf runs in Chromium headless with Playwright.
  - Network assumptions for CI are loopback/local service-to-service.
- **Sampling**:
  - Latency measurements use at least 100 samples in CI.
  - FPS measurements use at least 5 seconds of active interaction.
  - Report p50, p95, and p99 when available.

## Hard Budgets

- `cursorSyncLatencyMs.p95 <= 50`
- `objectSyncLatencyMs.p95 <= 100`
- `canvasFps.avg >= 60`
- `objectCapacity.min >= 500`
- `concurrentUsers.min >= 5`

## Soft Warnings

- `cursorSyncLatencyMs.p99 <= 75`
- `objectSyncLatencyMs.p99 <= 150`
- `canvasLongFramesPerMinute <= 120`

Soft warnings do not fail CI by default, but they should be tracked in perf artifacts and treated as regression signals.
