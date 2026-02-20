/**
 * AI Reliability Check
 *
 * Fetches the last N ai-command traces from LangSmith, runs deterministic
 * heuristic checks on each (output coherence, tool-call efficiency, protocol
 * adherence), and validates against the reliability budget.
 *
 * Output:
 *   - artifacts/ai-reliability-latest.md   (human-readable report)
 *   - artifacts/ai-reliability-latest.json  (machine-readable)
 *   - stdout markdown summary
 *
 * Usage:
 *   bun --env-file=.env scripts/ai-reliability-check.ts [count]
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

const DEFAULT_TRACE_COUNT = 10;
const MAX_AGENT_STEPS = 4;

const ALLOWED_COLORS = new Set([
  "#facc15", "#f472b6", "#60a5fa", "#4ade80", "#c084fc", "#fb923c",
  "#ffffff", "#d4d4d4", "#f87171", "#2dd4bf",
  "#f5f5f5", "#fef9c3", "#fce7f3", "#dbeafe", "#dcfce7", "#f3e8ff",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckResult = {
  name: string;
  passed: boolean;
  detail: string;
};

type TraceAnalysis = {
  traceId: string;
  timestamp: string;
  userPrompt: string;
  finalResponse: string;
  toolsCalled: string[];
  llmCount: number;
  checks: CheckResult[];
  score: number;
  passed: boolean;
};

type Budgets = {
  thresholds: {
    aiReliability?: {
      minPassRate: number;
    };
  };
};

// ---------------------------------------------------------------------------
// Fetch traces and child runs
// ---------------------------------------------------------------------------

async function fetchRecentTraces(count: number): Promise<Run[]> {
  const runs: Run[] = [];
  for await (const run of client.listRuns({
    projectName: PROJECT_NAME,
    isRoot: true,
    filter: 'has(tags, "ai-command")',
  })) {
    runs.push(run);
    if (runs.length >= count) break;
  }
  return runs;
}

async function fetchChildRuns(traceId: string): Promise<Run[]> {
  const runs: Run[] = [];
  for await (const run of client.listRuns({
    traceId,
    projectName: PROJECT_NAME,
  })) {
    runs.push(run);
  }
  return runs.sort(
    (a, b) => new Date(a.start_time ?? 0).getTime() - new Date(b.start_time ?? 0).getTime()
  );
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractUserPrompt(trace: Run): string {
  if (trace.inputs) {
    const inp = trace.inputs as Record<string, unknown>;
    if (inp.prompt && typeof inp.prompt === "string") return inp.prompt;
    if (inp.args) {
      const args = inp.args as Record<string, unknown>;
      if (args.prompt && typeof args.prompt === "string") return args.prompt;
    }
  }
  return JSON.stringify(trace.inputs ?? "(none)");
}

function extractFinalResponse(trace: Run): string {
  if (trace.outputs) {
    const out = trace.outputs as Record<string, unknown>;
    if (out.text && typeof out.text === "string") return out.text;
    if (typeof trace.outputs === "string") return trace.outputs;
    return JSON.stringify(trace.outputs);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Heuristic checks
// ---------------------------------------------------------------------------

const MUTATION_TOOLS = new Set([
  "batchCreateElements",
  "batchModifyElements",
  "resizeFrameToFitContent",
  "layoutElements",
  "createConnector",
  "deleteObject",
]);

const TOOL_ACTION_KEYWORDS: Record<string, string[]> = {
  batchCreateElements: ["created", "create", "added", "add", "made", "built"],
  batchModifyElements: ["modified", "modify", "changed", "change", "updated", "update", "moved", "move", "resized", "resize", "recolored"],
  deleteObject: ["deleted", "delete", "removed", "remove"],
  layoutElements: ["arranged", "arrange", "laid out", "layout", "organized", "organize"],
  resizeFrameToFitContent: ["resized", "resize", "fit", "adjusted"],
  createConnector: ["connected", "connect", "connector", "linked", "link"],
};

const REFUSAL_PATTERNS = [
  /i(?:'m| am) sorry/i,
  /i can(?:'t|not) do that/i,
  /i don(?:'t|'t) understand/i,
  /unable to (?:perform|complete)/i,
  /i(?:'m| am) not able to/i,
];

function runChecks(
  trace: Run,
  allRuns: Run[]
): CheckResult[] {
  const checks: CheckResult[] = [];
  const toolRuns = allRuns.filter((r) => r.run_type === "tool");
  const llmRuns = allRuns.filter((r) => r.run_type === "llm");
  const toolNames = toolRuns.map((r) => r.name);
  const response = extractFinalResponse(trace);
  const toolNameSet = new Set(toolNames);

  // 1a. Has final response
  checks.push({
    name: "has-final-response",
    passed: response.length > 0,
    detail: response.length > 0
      ? `Response: ${response.length} chars`
      : "No output text recorded on trace",
  });

  // 1b. Tool calls match response
  if (toolRuns.length > 0 && response.length > 0) {
    const responseLower = response.toLowerCase();
    const mutationToolsUsed = toolNames.filter((t) => MUTATION_TOOLS.has(t));
    const uniqueMutations = [...new Set(mutationToolsUsed)];

    if (uniqueMutations.length > 0) {
      const hasMatchingKeyword = uniqueMutations.some((toolName) => {
        const keywords = TOOL_ACTION_KEYWORDS[toolName] ?? [];
        return keywords.some((kw) => responseLower.includes(kw));
      });

      checks.push({
        name: "tool-calls-match-response",
        passed: hasMatchingKeyword,
        detail: hasMatchingKeyword
          ? `Response mentions actions for: ${uniqueMutations.join(", ")}`
          : `Response "${response.slice(0, 80)}..." doesn't mention actions for: ${uniqueMutations.join(", ")}`,
      });
    }
  }

  // 1c. No unacknowledged errors
  const errorRuns = toolRuns.filter((r) => r.error != null);
  const hasErrorMention = response.toLowerCase().includes("error") ||
    response.toLowerCase().includes("failed") ||
    response.toLowerCase().includes("couldn't") ||
    response.toLowerCase().includes("not found");
  if (errorRuns.length > 0) {
    checks.push({
      name: "no-unacknowledged-errors",
      passed: hasErrorMention,
      detail: hasErrorMention
        ? `${errorRuns.length} error(s) acknowledged in response`
        : `${errorRuns.length} error(s) in tool runs but response doesn't mention failure`,
    });
  } else {
    checks.push({
      name: "no-unacknowledged-errors",
      passed: true,
      detail: "No error-level tool runs",
    });
  }

  // 1d. No refusal when tools succeeded
  if (toolRuns.length > 0 && errorRuns.length === 0 && response.length > 0) {
    const isRefusal = REFUSAL_PATTERNS.some((p) => p.test(response));
    checks.push({
      name: "no-false-refusal",
      passed: !isRefusal,
      detail: isRefusal
        ? `Response contains refusal language despite successful tool calls`
        : "No refusal patterns detected",
    });
  }

  // 2a. No redundant getBoardState
  const getBoardStateCount = toolNames.filter((t) => t === "getBoardState").length;
  checks.push({
    name: "no-redundant-getBoardState",
    passed: getBoardStateCount <= 1,
    detail: getBoardStateCount <= 1
      ? `getBoardState called ${getBoardStateCount} time(s)`
      : `getBoardState called ${getBoardStateCount} times (expected at most 1)`,
  });

  // 2b. No getBoardState on create-only traces
  const mutationsUsed = new Set(toolNames.filter((t) => MUTATION_TOOLS.has(t)));
  const isCreateOnly =
    mutationsUsed.size > 0 &&
    [...mutationsUsed].every(
      (t) => t === "batchCreateElements" || t === "resizeFrameToFitContent"
    );
  if (isCreateOnly && getBoardStateCount > 0) {
    checks.push({
      name: "no-getBoardState-on-create-only",
      passed: false,
      detail: `getBoardState called but only create/resize tools were used`,
    });
  } else if (isCreateOnly) {
    checks.push({
      name: "no-getBoardState-on-create-only",
      passed: true,
      detail: "Create-only trace correctly skipped getBoardState",
    });
  }

  // 2c. Single-step when possible
  if (isCreateOnly && toolRuns.length > 1) {
    checks.push({
      name: "single-step-when-possible",
      passed: false,
      detail: `${toolRuns.length} tool calls for create-only trace (expected at most 1)`,
    });
  } else if (isCreateOnly) {
    checks.push({
      name: "single-step-when-possible",
      passed: true,
      detail: `${toolRuns.length} tool call(s) for create-only trace`,
    });
  }

  // 2d. No excessive steps
  checks.push({
    name: "no-excessive-steps",
    passed: llmRuns.length <= MAX_AGENT_STEPS,
    detail: llmRuns.length <= MAX_AGENT_STEPS
      ? `${llmRuns.length} LLM call(s) (max ${MAX_AGENT_STEPS})`
      : `${llmRuns.length} LLM calls exceeds max ${MAX_AGENT_STEPS}`,
  });

  // 2e. Batch efficiency
  const batchCreateCount = toolNames.filter((t) => t === "batchCreateElements").length;
  if (batchCreateCount > 0) {
    checks.push({
      name: "batch-create-efficiency",
      passed: batchCreateCount <= 1,
      detail: batchCreateCount <= 1
        ? `batchCreateElements called ${batchCreateCount} time`
        : `batchCreateElements called ${batchCreateCount} times (should batch into 1 call)`,
    });
  }

  // 3a. Allowed colors only
  const colorViolations: string[] = [];
  for (const tool of toolRuns) {
    if (tool.inputs && typeof tool.inputs === "object") {
      collectColorViolations(tool.inputs as Record<string, unknown>, colorViolations);
    }
  }
  if (toolRuns.length > 0) {
    checks.push({
      name: "allowed-colors-only",
      passed: colorViolations.length === 0,
      detail: colorViolations.length === 0
        ? "All colors from allowed palettes"
        : `Disallowed colors: ${[...new Set(colorViolations)].join(", ")}`,
    });
  }

  // 3b. Minimal diff in modifications
  const modifyRuns = toolRuns.filter((r) => r.name === "batchModifyElements");
  if (modifyRuns.length > 0) {
    const bloatedMods: string[] = [];
    for (const run of modifyRuns) {
      const input = run.inputs as Record<string, unknown> | null;
      const mods = (input?.modifications ?? []) as Array<Record<string, unknown>>;
      for (const mod of mods) {
        const fieldCount = Object.keys(mod).filter((k) => k !== "objectId").length;
        if (fieldCount > 4) {
          bloatedMods.push(`${mod.objectId}: ${fieldCount} fields`);
        }
      }
    }
    checks.push({
      name: "minimal-modify-diff",
      passed: bloatedMods.length === 0,
      detail: bloatedMods.length === 0
        ? "All modifications use minimal diffs"
        : `Bloated modifications (>4 changed fields): ${bloatedMods.join("; ")}`,
    });
  }

  return checks;
}

function collectColorViolations(obj: Record<string, unknown>, violations: string[]): void {
  for (const [key, value] of Object.entries(obj)) {
    if (key === "color" && typeof value === "string") {
      if (!ALLOWED_COLORS.has(value.toLowerCase())) {
        violations.push(value);
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          collectColorViolations(item as Record<string, unknown>, violations);
        }
      }
    } else if (value && typeof value === "object") {
      collectColorViolations(value as Record<string, unknown>, violations);
    }
  }
}

// ---------------------------------------------------------------------------
// Analyze a single trace
// ---------------------------------------------------------------------------

async function analyzeTrace(trace: Run): Promise<TraceAnalysis> {
  const allRuns = await fetchChildRuns(trace.trace_id!);
  const childRuns = allRuns.filter((r) => r.id !== trace.id);
  const toolRuns = childRuns.filter((r) => r.run_type === "tool");
  const llmRuns = childRuns.filter((r) => r.run_type === "llm");
  const checks = runChecks(trace, childRuns);

  const passedCount = checks.filter((c) => c.passed).length;
  const score = checks.length > 0 ? Math.round((passedCount / checks.length) * 100) : 100;

  return {
    traceId: trace.trace_id!,
    timestamp: trace.start_time?.toString() ?? "",
    userPrompt: extractUserPrompt(trace),
    finalResponse: extractFinalResponse(trace),
    toolsCalled: toolRuns.map((r) => r.name),
    llmCount: llmRuns.length,
    checks,
    score,
    passed: checks.every((c) => c.passed),
  };
}

// ---------------------------------------------------------------------------
// Render markdown report
// ---------------------------------------------------------------------------

function renderReport(
  analyses: TraceAnalysis[],
  budgetResult: string,
  passRate: number,
  failures: string[],
  warnings: string[]
): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push("# AI Reliability Report");
  push("");
  push(`Generated: ${new Date().toISOString()}`);
  push(`Traces analyzed: ${analyses.length}`);
  push("");

  push("## Summary");
  push("");
  const passedTraces = analyses.filter((a) => a.passed).length;
  push(`| Metric | Value |`);
  push(`|--------|-------|`);
  push(`| Traces analyzed | ${analyses.length} |`);
  push(`| Traces passing all checks | ${passedTraces} |`);
  push(`| Pass rate | ${passRate.toFixed(1)}% |`);
  push(`| Average score | ${(analyses.reduce((s, a) => s + a.score, 0) / analyses.length).toFixed(1)}% |`);
  push(`| Budget result | ${budgetResult} |`);
  push("");

  if (failures.length > 0) {
    push("### Failures");
    push("");
    for (const f of failures) push(`- ${f}`);
    push("");
  }
  if (warnings.length > 0) {
    push("### Warnings");
    push("");
    for (const w of warnings) push(`- ${w}`);
    push("");
  }

  const checkStats = new Map<string, { total: number; failed: number }>();
  for (const analysis of analyses) {
    for (const check of analysis.checks) {
      const stat = checkStats.get(check.name) ?? { total: 0, failed: 0 };
      stat.total++;
      if (!check.passed) stat.failed++;
      checkStats.set(check.name, stat);
    }
  }

  push("## Check Failure Rates");
  push("");
  push("| Check | Evaluated | Failed | Failure Rate |");
  push("|-------|-----------|--------|--------------|");
  for (const [name, stat] of checkStats) {
    const rate = stat.total > 0 ? ((stat.failed / stat.total) * 100).toFixed(1) : "0.0";
    push(`| ${name} | ${stat.total} | ${stat.failed} | ${rate}% |`);
  }
  push("");

  push("## Per-Trace Analysis");
  push("");

  for (const analysis of analyses) {
    const status = analysis.passed ? "PASS" : "FAIL";
    push(`### Trace \`${analysis.traceId}\` — ${status} (${analysis.score}%)`);
    push("");
    push(`- **Timestamp:** ${analysis.timestamp}`);
    push(`- **Prompt:** ${analysis.userPrompt.slice(0, 200)}${analysis.userPrompt.length > 200 ? "..." : ""}`);
    push(`- **Response:** ${analysis.finalResponse.slice(0, 200)}${analysis.finalResponse.length > 200 ? "..." : ""}`);
    push(`- **Tools called:** ${analysis.toolsCalled.length > 0 ? analysis.toolsCalled.join(", ") : "(none)"}`);
    push(`- **LLM calls:** ${analysis.llmCount}`);
    push("");

    const failedChecks = analysis.checks.filter((c) => !c.passed);
    if (failedChecks.length > 0) {
      push("**Failed checks:**");
      push("");
      for (const check of failedChecks) {
        push(`- **${check.name}**: ${check.detail}`);
      }
      push("");
    }

    push("<details><summary>All checks</summary>");
    push("");
    push("| Check | Result | Detail |");
    push("|-------|--------|--------|");
    for (const check of analysis.checks) {
      push(`| ${check.name} | ${check.passed ? "PASS" : "FAIL"} | ${check.detail} |`);
    }
    push("");
    push("</details>");
    push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const traceCount = parseInt(process.argv[2] ?? String(DEFAULT_TRACE_COUNT), 10);
  console.log(`Fetching last ${traceCount} AI command traces...\n`);

  const traces = await fetchRecentTraces(traceCount);
  console.log(`Found ${traces.length} traces. Analyzing...\n`);

  if (traces.length === 0) {
    console.error("No ai-command traces found. Nothing to analyze.");
    process.exitCode = 1;
    return;
  }

  const analyses: TraceAnalysis[] = [];
  for (const trace of traces) {
    const analysis = await analyzeTrace(trace);
    analyses.push(analysis);
    const status = analysis.passed ? "PASS" : "FAIL";
    console.log(`  ${analysis.traceId.slice(0, 12)}... ${status} (${analysis.score}%)`);
  }

  const passedTraces = analyses.filter((a) => a.passed).length;
  const passRate = (passedTraces / analyses.length) * 100;

  const ROOT = resolve(process.cwd());
  const budgetsPath = resolve(ROOT, "docs/performance-budgets.json");
  const budgets = JSON.parse(await readFile(budgetsPath, "utf8")) as Budgets;
  const reliabilityThreshold = budgets.thresholds.aiReliability;

  const failures: string[] = [];
  const warnings: string[] = [];

  if (reliabilityThreshold) {
    if (passRate < reliabilityThreshold.minPassRate) {
      failures.push(
        `Pass rate ${passRate.toFixed(1)}% < ${reliabilityThreshold.minPassRate}% budget`
      );
    }
  } else {
    warnings.push("No aiReliability thresholds defined in performance-budgets.json");
  }

  const budgetResult = failures.length > 0 ? "FAIL" : "PASS";

  const artifact = {
    generatedAt: new Date().toISOString(),
    traceCount: analyses.length,
    passedTraces,
    passRate: Math.round(passRate * 10) / 10,
    averageScore:
      Math.round(
        (analyses.reduce((s, a) => s + a.score, 0) / analyses.length) * 10
      ) / 10,
    budgetResult,
    failures,
    warnings,
    traces: analyses.map((a) => ({
      traceId: a.traceId,
      timestamp: a.timestamp,
      prompt: a.userPrompt.slice(0, 200),
      toolsCalled: a.toolsCalled,
      llmCount: a.llmCount,
      score: a.score,
      passed: a.passed,
      failedChecks: a.checks
        .filter((c) => !c.passed)
        .map((c) => ({ name: c.name, detail: c.detail })),
    })),
  };

  const artifactDir = join(ROOT, "artifacts");
  await mkdir(artifactDir, { recursive: true });

  const jsonPath = join(artifactDir, "ai-reliability-latest.json");
  await writeFile(jsonPath, JSON.stringify(artifact, null, 2) + "\n");

  const report = renderReport(analyses, budgetResult, passRate, failures, warnings);
  const mdPath = join(artifactDir, "ai-reliability-latest.md");
  await writeFile(mdPath, report + "\n");

  console.log("\n" + report);
  console.log(`\n---\nArtifacts saved to:\n  ${jsonPath}\n  ${mdPath}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("AI Reliability Check failed:", err);
  process.exitCode = 1;
});
