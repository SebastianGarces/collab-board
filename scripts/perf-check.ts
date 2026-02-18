import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Budgets = {
  thresholds: {
    cursorSyncLatencyMs: { p95Max: number };
    objectSyncLatencyMs: { p95Max: number };
    canvasFps: { avgMin: number };
    objectCapacity: { min: number };
    concurrentUsers: { min: number };
    canvasLongFramesPerMinute: { max: number };
    inputToRenderMs: { p95Max: number };
  };
};

type BackendSummary = {
  concurrentUsers: number;
  cursorSyncLatencyMs: { p95: number };
  objectSyncLatencyMs: { p95: number };
  objectCapacity: number;
};

type FrontendSummary = {
  canvasFps: { avg: number };
  canvasLongFramesPerMinute: number;
  inputToRenderMs: { p95: number };
  probeLatencyMs: {
    cursor: {
      p95: number;
    };
  };
};

const ROOT = resolve(process.cwd());
const BUDGETS_PATH = resolve(ROOT, "docs/performance-budgets.json");
const BACKEND_PATH = resolve(ROOT, "artifacts/perf/ws-benchmark-latest.json");
const FRONTEND_PATH = resolve(ROOT, "artifacts/perf/frontend-perf-latest.json");

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function main() {
  const budgets = await readJson<Budgets>(BUDGETS_PATH);
  const backend = await readJson<BackendSummary>(BACKEND_PATH);
  const frontend = await readJson<FrontendSummary>(FRONTEND_PATH);
  const failures: string[] = [];

  if (backend.cursorSyncLatencyMs.p95 > budgets.thresholds.cursorSyncLatencyMs.p95Max) {
    failures.push(
      `backend cursor p95 ${backend.cursorSyncLatencyMs.p95.toFixed(2)}ms > ${budgets.thresholds.cursorSyncLatencyMs.p95Max}ms`
    );
  }
  if (backend.objectSyncLatencyMs.p95 > budgets.thresholds.objectSyncLatencyMs.p95Max) {
    failures.push(
      `backend object p95 ${backend.objectSyncLatencyMs.p95.toFixed(2)}ms > ${budgets.thresholds.objectSyncLatencyMs.p95Max}ms`
    );
  }
  if (backend.concurrentUsers < budgets.thresholds.concurrentUsers.min) {
    failures.push(
      `backend concurrent users ${backend.concurrentUsers} < ${budgets.thresholds.concurrentUsers.min}`
    );
  }
  if (backend.objectCapacity < budgets.thresholds.objectCapacity.min) {
    failures.push(`backend object capacity ${backend.objectCapacity} < ${budgets.thresholds.objectCapacity.min}`);
  }
  if (frontend.canvasFps.avg < budgets.thresholds.canvasFps.avgMin) {
    failures.push(
      `frontend avg fps ${frontend.canvasFps.avg.toFixed(2)} < ${budgets.thresholds.canvasFps.avgMin}`
    );
  }
  if (frontend.probeLatencyMs.cursor.p95 > budgets.thresholds.cursorSyncLatencyMs.p95Max) {
    failures.push(
      `frontend cursor p95 ${frontend.probeLatencyMs.cursor.p95.toFixed(2)}ms > ${budgets.thresholds.cursorSyncLatencyMs.p95Max}ms`
    );
  }
  if (frontend.canvasLongFramesPerMinute > budgets.thresholds.canvasLongFramesPerMinute.max) {
    failures.push(
      `frontend long frames/min ${frontend.canvasLongFramesPerMinute.toFixed(2)} > ${budgets.thresholds.canvasLongFramesPerMinute.max}`
    );
  }
  if (frontend.inputToRenderMs.p95 > budgets.thresholds.inputToRenderMs.p95Max) {
    failures.push(
      `frontend input->render p95 ${frontend.inputToRenderMs.p95.toFixed(2)}ms > ${budgets.thresholds.inputToRenderMs.p95Max}ms`
    );
  }

  if (failures.length) {
    console.error("[perf] budget failures:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.info("[perf] all performance budgets passed.");
}

main().catch((error) => {
  console.error("[perf] unable to verify budgets:", error);
  process.exitCode = 1;
});
