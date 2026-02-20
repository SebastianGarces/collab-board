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
  reset: () => void;
};

const MAX_FRAME_SAMPLES = 600;
const MAX_INPUT_SAMPLES = 600;
const MAX_PROBE_SAMPLES = 300;

class RingBuffer {
  private buf: Float64Array;
  private head = 0;
  private _size = 0;

  constructor(private capacity: number) {
    this.buf = new Float64Array(capacity);
  }

  push(value: number) {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  get size() {
    return this._size;
  }

  toArray(): number[] {
    if (this._size === 0) return [];
    if (this._size < this.capacity) {
      return Array.from(this.buf.subarray(0, this._size));
    }
    const result = new Array<number>(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      result[i] = this.buf[(this.head + i) % this.capacity];
    }
    return result;
  }

  clear() {
    this.head = 0;
    this._size = 0;
  }

  reduce(fn: (acc: number, val: number) => number, initial: number): number {
    let acc = initial;
    if (this._size < this.capacity) {
      for (let i = 0; i < this._size; i++) acc = fn(acc, this.buf[i]);
    } else {
      for (let i = 0; i < this.capacity; i++) {
        acc = fn(acc, this.buf[(this.head + i) % this.capacity]);
      }
    }
    return acc;
  }

  count(predicate: (val: number) => boolean): number {
    let c = 0;
    if (this._size < this.capacity) {
      for (let i = 0; i < this._size; i++) if (predicate(this.buf[i])) c++;
    } else {
      for (let i = 0; i < this.capacity; i++) {
        if (predicate(this.buf[(this.head + i) % this.capacity])) c++;
      }
    }
    return c;
  }
}

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

function ringToStats(ring: RingBuffer): PerfStats {
  return toStats(ring.toArray());
}

export function createPerfProbeCollector(): PerfProbeCollector {
  const frameDurations = new RingBuffer(MAX_FRAME_SAMPLES);
  const inputToRenderDurations = new RingBuffer(MAX_INPUT_SAMPLES);
  const probeDurations: Record<PerfProbeKind, RingBuffer> = {
    cursor: new RingBuffer(MAX_PROBE_SAMPLES),
    object: new RingBuffer(MAX_PROBE_SAMPLES),
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
      const totalFrameTime = frameDurations.reduce((acc, v) => acc + v, 0);
      const avgFrameTime = frameDurations.size ? totalFrameTime / frameDurations.size : 0;
      const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
      const longFrames = frameDurations.count((d) => d > 16.7);
      const sampleWindowMs = firstFrameAt && lastFrameAt ? lastFrameAt - firstFrameAt : 0;
      const longFramesPerMinute =
        sampleWindowMs > 0 ? longFrames * (60_000 / sampleWindowMs) : 0;

      return {
        canvasFps: {
          avg: fps,
          sampleCount: frameDurations.size
        },
        canvasLongFramesPerMinute: longFramesPerMinute,
        inputToRenderMs: ringToStats(inputToRenderDurations),
        probeLatencyMs: {
          cursor: ringToStats(probeDurations.cursor),
          object: ringToStats(probeDurations.object)
        }
      };
    },
    reset() {
      frameDurations.clear();
      inputToRenderDurations.clear();
      probeDurations.cursor.clear();
      probeDurations.object.clear();
      lastFrameAt = 0;
      firstFrameAt = 0;
      lastInputAt = null;
    }
  };
}
