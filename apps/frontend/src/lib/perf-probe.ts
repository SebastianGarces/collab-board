import type { PerfProbeKind } from "@collab/shared/collab";

type PerfStats = {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  count: number;
};

type PerfSummary = {
  canvasFps: {
    avg: number;
    sampleCount: number;
  };
  canvasLongFramesPerMinute: number;
  inputToRenderMs: PerfStats;
  probeLatencyMs: Record<PerfProbeKind, PerfStats>;
};

type PerfProbeCollector = {
  startFrameSampling: () => void;
  stopFrameSampling: () => void;
  markInput: () => void;
  recordProbe: (kind: PerfProbeKind, latencyMs: number) => void;
  getSummary: () => PerfSummary;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function toStats(values: number[]): PerfStats {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, count: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: total / values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    count: values.length
  };
}

export function createPerfProbeCollector(): PerfProbeCollector {
  const frameDurations: number[] = [];
  const inputToRenderDurations: number[] = [];
  const probeDurations: Record<PerfProbeKind, number[]> = {
    cursor: [],
    object: []
  };

  let rafId = 0;
  let isRunning = false;
  let lastFrameAt = 0;
  let firstFrameAt = 0;
  let lastInputAt: number | null = null;

  const onFrame = (now: number) => {
    if (!isRunning) return;
    if (!firstFrameAt) firstFrameAt = now;
    if (lastFrameAt > 0) {
      frameDurations.push(now - lastFrameAt);
    }
    lastFrameAt = now;

    if (lastInputAt !== null) {
      inputToRenderDurations.push(Math.max(0, now - lastInputAt));
      lastInputAt = null;
    }

    rafId = requestAnimationFrame(onFrame);
  };

  return {
    startFrameSampling() {
      if (isRunning) return;
      isRunning = true;
      rafId = requestAnimationFrame(onFrame);
    },
    stopFrameSampling() {
      if (!isRunning) return;
      isRunning = false;
      cancelAnimationFrame(rafId);
    },
    markInput() {
      if (!isRunning) return;
      lastInputAt = performance.now();
    },
    recordProbe(kind, latencyMs) {
      if (!Number.isFinite(latencyMs)) return;
      probeDurations[kind].push(Math.max(0, latencyMs));
    },
    getSummary() {
      const totalFrameTime = frameDurations.reduce((sum, value) => sum + value, 0);
      const avgFrameTime = frameDurations.length ? totalFrameTime / frameDurations.length : 0;
      const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
      const longFrames = frameDurations.filter((duration) => duration > 16.7).length;
      const sampleWindowMs = firstFrameAt && lastFrameAt ? lastFrameAt - firstFrameAt : 0;
      const longFramesPerMinute =
        sampleWindowMs > 0 ? longFrames * (60_000 / sampleWindowMs) : 0;

      return {
        canvasFps: {
          avg: fps,
          sampleCount: frameDurations.length
        },
        canvasLongFramesPerMinute: longFramesPerMinute,
        inputToRenderMs: toStats(inputToRenderDurations),
        probeLatencyMs: {
          cursor: toStats(probeDurations.cursor),
          object: toStats(probeDurations.object)
        }
      };
    }
  };
}
