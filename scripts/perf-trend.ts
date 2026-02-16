import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

type MetricPoint = {
  createdAt: string;
  file: string;
  cursorP95?: number;
  objectP95?: number;
  fpsAvg?: number;
};

type WsSummary = {
  createdAt: string;
  cursorSyncLatencyMs: { p95: number };
  objectSyncLatencyMs: { p95: number };
};

type FrontSummary = {
  createdAt?: string;
  canvasFps?: { avg: number };
  summary?: {
    canvasFps?: { avg: number };
  };
};

const PERF_DIR = resolve(process.cwd(), "artifacts/perf");
const WINDOW = 10;

function toDeltaPercent(first: number, last: number) {
  if (first === 0) return 0;
  return ((last - first) / first) * 100;
}

async function main() {
  const files = (await readdir(PERF_DIR))
    .filter((file) => file.startsWith("ws-benchmark-") || file.startsWith("frontend-perf-"))
    .sort();

  const points: MetricPoint[] = [];
  for (const file of files) {
    const path = resolve(PERF_DIR, file);
    if (file.startsWith("ws-benchmark-") && file.endsWith(".json")) {
      const json = JSON.parse(await readFile(path, "utf8")) as WsSummary;
      points.push({
        createdAt: json.createdAt,
        file,
        cursorP95: json.cursorSyncLatencyMs.p95,
        objectP95: json.objectSyncLatencyMs.p95
      });
    } else if (file.startsWith("frontend-perf-") && file.endsWith(".json")) {
      const json = JSON.parse(await readFile(path, "utf8")) as FrontSummary;
      const fpsAvg = json.canvasFps?.avg ?? json.summary?.canvasFps?.avg;
      if (fpsAvg === undefined) continue;
      points.push({
        createdAt: json.createdAt ?? new Date().toISOString(),
        file,
        fpsAvg
      });
    }
  }

  const windowPoints = points.slice(-WINDOW);
  const cursorSeries = windowPoints.map((point) => point.cursorP95).filter((value): value is number => value !== undefined);
  const objectSeries = windowPoints.map((point) => point.objectP95).filter((value): value is number => value !== undefined);
  const fpsSeries = windowPoints.map((point) => point.fpsAvg).filter((value): value is number => value !== undefined);

  const cursorDelta = cursorSeries.length > 1 ? toDeltaPercent(cursorSeries[0], cursorSeries[cursorSeries.length - 1]) : 0;
  const objectDelta = objectSeries.length > 1 ? toDeltaPercent(objectSeries[0], objectSeries[objectSeries.length - 1]) : 0;
  const fpsDelta = fpsSeries.length > 1 ? toDeltaPercent(fpsSeries[0], fpsSeries[fpsSeries.length - 1]) : 0;

  console.info(
    JSON.stringify(
      {
        type: "perf_trend",
        pointsAnalyzed: windowPoints.length,
        cursorP95DeltaPercent: Number(cursorDelta.toFixed(2)),
        objectP95DeltaPercent: Number(objectDelta.toFixed(2)),
        fpsAvgDeltaPercent: Number(fpsDelta.toFixed(2))
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[perf] trend script failed:", error);
  process.exitCode = 1;
});
