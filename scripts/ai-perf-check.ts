/**
 * AI Performance Check
 *
 * Queries LangSmith for recent AI command traces, computes latency percentiles,
 * and validates against the performance budgets in performance-budgets.json.
 *
 * Output:
 *   - artifacts/ai-perf-latest.json  (machine-readable)
 *   - stdout markdown summary        (human-readable)
 *
 * Usage:
 *   bun --env-file=.env scripts/ai-perf-check.ts [count]
 *
 *   count  (optional) – fetch the last N traces instead of the default 7-day lookback
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Client, type Run } from "langsmith";

const LANGCHAIN_API_KEY = process.env.LANGCHAIN_API_KEY ?? process.env.LANGSMITH_API_KEY;
const PROJECT_NAME = process.env.LANGCHAIN_PROJECT ?? process.env.LANGSMITH_PROJECT ?? "default";

if (!LANGCHAIN_API_KEY) {
  console.error("Missing LANGCHAIN_API_KEY or LANGSMITH_API_KEY env var.");
  process.exit(1);
}

const client = new Client();

const MIN_TRACE_COUNT = 10;
const LOOKBACK_DAYS = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Budgets = {
  thresholds: {
    aiResponseLatencyMs?: {
      singleStepP95Max: number;
      singleStepP99Max: number;
    };
  };
};

type TraceWithChildren = {
  trace: Run;
  llmCount: number;
  toolCount: number;
};

// ---------------------------------------------------------------------------
// Fetch ai-command root traces from LangSmith
// ---------------------------------------------------------------------------

async function fetchAiTraces(count?: number): Promise<Run[]> {
  const runs: Run[] = [];
  const opts: Parameters<typeof client.listRuns>[0] = {
    projectName: PROJECT_NAME,
    isRoot: true,
    filter: 'has(tags, "ai-command")',
  };

  if (count === undefined) {
    opts.startTime = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  }

  for await (const run of client.listRuns(opts)) {
    runs.push(run);
    if (count !== undefined && runs.length >= count) break;
  }

  return runs;
}

// ---------------------------------------------------------------------------
// Fetch child runs for a trace and count by run_type.
// LangSmith natively types each run as "llm", "tool", "chain", etc.
// Single-step: 1 tool call (→ 2 llm runs: tool-call generation + final response)
// Multi-step: 2+ tool calls (→ 3+ llm runs: getBoardState + action + final)
// ---------------------------------------------------------------------------

async function enrichTrace(trace: Run): Promise<TraceWithChildren> {
  let llmCount = 0;
  let toolCount = 0;

  for await (const child of client.listRuns({
    traceId: trace.trace_id,
    projectName: PROJECT_NAME,
  })) {
    if (child.id === trace.id) continue;
    if (child.run_type === "llm") llmCount++;
    if (child.run_type === "tool") toolCount++;
  }

  return { trace, llmCount, toolCount };
}

const ENRICH_CONCURRENCY = 5;

async function enrichTraces(traces: Run[]): Promise<TraceWithChildren[]> {
  const results: TraceWithChildren[] = [];
  for (let i = 0; i < traces.length; i += ENRICH_CONCURRENCY) {
    const batch = traces.slice(i, i + ENRICH_CONCURRENCY);
    const enriched = await Promise.all(batch.map(enrichTrace));
    results.push(...enriched);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Classify: <=1 tool call = single-step, 2+ tool calls = multi-step
// ---------------------------------------------------------------------------

function classifyTraces(enriched: TraceWithChildren[]) {
  const singleStep: Run[] = [];
  const multiStep: Run[] = [];

  for (const { trace, toolCount } of enriched) {
    if (toolCount <= 1) {
      singleStep.push(trace);
    } else {
      multiStep.push(trace);
    }
  }

  return { singleStep, multiStep };
}

// ---------------------------------------------------------------------------
// Percentile computation
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function latencyMs(run: Run): number {
  if (!run.end_time || !run.start_time) return 0;
  return new Date(run.end_time).getTime() - new Date(run.start_time).getTime();
}

function computeStats(latenciesMs: number[]) {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    avg: sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const countArg = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
  if (countArg !== undefined && (isNaN(countArg) || countArg <= 0)) {
    console.error("Usage: bun --env-file=.env scripts/ai-perf-check.ts [count]");
    process.exit(1);
  }

  const modeLabel = countArg !== undefined
    ? `last ${countArg} traces`
    : `last ${LOOKBACK_DAYS} days`;
  console.log(`Fetching AI command traces (${modeLabel})...\n`);

  const traces = await fetchAiTraces(countArg);
  console.log(`Found ${traces.length} ai-command traces.`);

  if (traces.length < MIN_TRACE_COUNT) {
    console.warn(
      `\nWarning: Only ${traces.length} traces found (minimum ${MIN_TRACE_COUNT} recommended). Results may be noisy.`
    );
  }

  console.log("Enriching traces with child run counts...");
  const enriched = await enrichTraces(traces);
  const { singleStep, multiStep } = classifyTraces(enriched);

  const singleStepLatenciesMs = singleStep.map(latencyMs);
  const multiStepLatenciesMs = multiStep.map(latencyMs);
  const allLatenciesMs = traces.map(latencyMs);

  const singleStepStats = computeStats(singleStepLatenciesMs);
  const multiStepStats = computeStats(multiStepLatenciesMs);
  const allStats = computeStats(allLatenciesMs);

  const totalCost = traces.reduce((s, t) => s + (t.total_cost ?? 0), 0);

  // Load budgets
  const ROOT = resolve(process.cwd());
  const budgetsPath = resolve(ROOT, "docs/performance-budgets.json");
  const budgets = JSON.parse(await readFile(budgetsPath, "utf8")) as Budgets;
  const aiThresholds = budgets.thresholds.aiResponseLatencyMs;

  const failures: string[] = [];
  const warnings: string[] = [];

  if (aiThresholds && traces.length >= MIN_TRACE_COUNT) {
    if (singleStepStats.p95 > aiThresholds.singleStepP95Max) {
      failures.push(
        `single-step p95 ${singleStepStats.p95.toFixed(0)}ms > ${aiThresholds.singleStepP95Max}ms budget`
      );
    }
    if (singleStepStats.p99 > aiThresholds.singleStepP99Max) {
      warnings.push(
        `single-step p99 ${singleStepStats.p99.toFixed(0)}ms > ${aiThresholds.singleStepP99Max}ms budget`
      );
    }
  } else if (!aiThresholds) {
    warnings.push(
      "No aiResponseLatencyMs thresholds defined in performance-budgets.json"
    );
  }

  // Build artifact
  const artifact = {
    generatedAt: new Date().toISOString(),
    mode: countArg !== undefined ? "count" as const : "lookback" as const,
    ...(countArg !== undefined ? { requestedCount: countArg } : { lookbackDays: LOOKBACK_DAYS }),
    traceCount: traces.length,
    singleStep: {
      count: singleStepStats.count,
      latencyMs: {
        min: Math.round(singleStepStats.min),
        max: Math.round(singleStepStats.max),
        avg: Math.round(singleStepStats.avg),
        p50: Math.round(singleStepStats.p50),
        p95: Math.round(singleStepStats.p95),
        p99: Math.round(singleStepStats.p99),
      },
    },
    multiStep: {
      count: multiStepStats.count,
      latencyMs: {
        min: Math.round(multiStepStats.min),
        max: Math.round(multiStepStats.max),
        avg: Math.round(multiStepStats.avg),
        p50: Math.round(multiStepStats.p50),
        p95: Math.round(multiStepStats.p95),
        p99: Math.round(multiStepStats.p99),
      },
    },
    all: {
      count: allStats.count,
      latencyMs: {
        min: Math.round(allStats.min),
        max: Math.round(allStats.max),
        avg: Math.round(allStats.avg),
        p50: Math.round(allStats.p50),
        p95: Math.round(allStats.p95),
        p99: Math.round(allStats.p99),
      },
    },
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    budgetResult: failures.length > 0 ? "FAIL" : "PASS",
    failures,
    warnings,
  };

  // Write artifact
  const artifactDir = join(ROOT, "artifacts");
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "ai-perf-latest.json");
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n");

  // Print markdown summary
  const md = `
# AI Performance Report

Generated: ${artifact.generatedAt}
Scope: ${modeLabel} | Traces: ${traces.length}

## Single-Step Commands (${singleStepStats.count} traces)

| Metric | Value |
|--------|-------|
| Min    | ${singleStepStats.min.toFixed(0)}ms |
| Avg    | ${singleStepStats.avg.toFixed(0)}ms |
| p50    | ${singleStepStats.p50.toFixed(0)}ms |
| p95    | ${singleStepStats.p95.toFixed(0)}ms ${aiThresholds ? (singleStepStats.p95 <= aiThresholds.singleStepP95Max ? "OK" : "FAIL") : ""} |
| p99    | ${singleStepStats.p99.toFixed(0)}ms ${aiThresholds ? (singleStepStats.p99 <= aiThresholds.singleStepP99Max ? "OK" : "WARN") : ""} |
| Max    | ${singleStepStats.max.toFixed(0)}ms |

## Multi-Step Commands (${multiStepStats.count} traces)

| Metric | Value |
|--------|-------|
| Min    | ${multiStepStats.min.toFixed(0)}ms |
| Avg    | ${multiStepStats.avg.toFixed(0)}ms |
| p50    | ${multiStepStats.p50.toFixed(0)}ms |
| p95    | ${multiStepStats.p95.toFixed(0)}ms |
| p99    | ${multiStepStats.p99.toFixed(0)}ms |
| Max    | ${multiStepStats.max.toFixed(0)}ms |

## Budget Result: ${artifact.budgetResult}
${failures.length > 0 ? "\nFailures:\n" + failures.map((f) => `  - ${f}`).join("\n") : ""}
${warnings.length > 0 ? "\nWarnings:\n" + warnings.map((w) => `  - ${w}`).join("\n") : ""}

Total AI cost (period): $${artifact.totalCost.toFixed(6)}
Artifact saved to: ${artifactPath}
`;

  console.log(md);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("AI Performance Check failed:", err);
  process.exitCode = 1;
});
