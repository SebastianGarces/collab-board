/**
 * AI Trace Review
 *
 * Fetches a single LangSmith trace by ID and outputs a structured markdown
 * report designed for AI-assisted review of the agent's behavior.
 *
 * Output:
 *   - artifacts/ai-trace-review.md  (full report)
 *   - stdout                        (same report)
 *
 * Usage:
 *   bun --env-file=.env scripts/ai-trace-review.ts <trace-id>
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Client, type Run } from "langsmith";

const LANGCHAIN_API_KEY = process.env.LANGCHAIN_API_KEY ?? process.env.LANGSMITH_API_KEY;
const PROJECT_NAME = process.env.LANGCHAIN_PROJECT ?? process.env.LANGSMITH_PROJECT ?? "default";

if (!LANGCHAIN_API_KEY) {
  console.error("Missing LANGCHAIN_API_KEY or LANGSMITH_API_KEY env var.");
  process.exit(1);
}

const traceId = process.argv[2];
if (!traceId) {
  console.error("Usage: bun --env-file=.env scripts/ai-trace-review.ts <trace-id>");
  process.exit(1);
}

const client = new Client();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function runLatencyMs(run: Run): string {
  if (!run.end_time || !run.start_time) return "N/A";
  const ms = new Date(run.end_time).getTime() - new Date(run.start_time).getTime();
  return `${ms}ms`;
}

// ---------------------------------------------------------------------------
// Fetch trace and child runs
// ---------------------------------------------------------------------------

async function fetchTraceRuns(id: string): Promise<Run[]> {
  const runs: Run[] = [];
  for await (const run of client.listRuns({
    traceId: id,
    projectName: PROJECT_NAME,
  })) {
    runs.push(run);
  }
  return runs.sort(
    (a, b) => new Date(a.start_time ?? 0).getTime() - new Date(b.start_time ?? 0).getTime()
  );
}

// ---------------------------------------------------------------------------
// Extract data from runs
// ---------------------------------------------------------------------------

function extractSystemPrompt(llmRuns: Run[]): string | null {
  for (const run of llmRuns) {
    const messages = run.inputs?.messages;
    if (Array.isArray(messages)) {
      const flat = messages.flat();
      const systemMsg = flat.find(
        (m: Record<string, unknown>) =>
          m.type === "system" || (m as Record<string, unknown>).role === "system"
      );
      if (systemMsg) {
        const content = (systemMsg as Record<string, unknown>).content ??
          ((systemMsg as Record<string, unknown>).data as Record<string, unknown>)?.content;
        return typeof content === "string" ? content : formatJson(content);
      }
    }
  }
  return null;
}

function extractUserPrompt(rootRun: Run, llmRuns: Run[]): string {
  if (rootRun.inputs) {
    const inp = rootRun.inputs as Record<string, unknown>;
    if (inp.prompt && typeof inp.prompt === "string") return inp.prompt;
    if (inp.args) {
      const args = inp.args as Record<string, unknown>;
      if (args.prompt && typeof args.prompt === "string") return args.prompt;
    }
  }

  if (llmRuns.length > 0) {
    const messages = llmRuns[0].inputs?.messages;
    if (Array.isArray(messages)) {
      const flat = messages.flat();
      const lastUser = [...flat]
        .reverse()
        .find(
          (m: Record<string, unknown>) =>
            m.type === "human" || (m as Record<string, unknown>).role === "user"
        );
      if (lastUser) {
        const content = (lastUser as Record<string, unknown>).content ??
          ((lastUser as Record<string, unknown>).data as Record<string, unknown>)?.content;
        return typeof content === "string" ? content : formatJson(content);
      }
    }
  }

  return formatJson(rootRun.inputs);
}

function extractConversationHistory(llmRuns: Run[]): string | null {
  if (llmRuns.length === 0) return null;
  const messages = llmRuns[0].inputs?.messages;
  if (!Array.isArray(messages)) return null;

  const flat = messages.flat();
  const nonSystemNonLastUser = flat.filter(
    (m: Record<string, unknown>, idx: number) => {
      const type = m.type ?? m.role;
      if (type === "system") return false;
      if ((type === "human" || type === "user") && idx === flat.length - 1) return false;
      return true;
    }
  );

  if (nonSystemNonLastUser.length === 0) return null;

  return nonSystemNonLastUser
    .map((m: Record<string, unknown>) => {
      const role = m.type ?? m.role ?? "unknown";
      const content = m.content ?? (m.data as Record<string, unknown>)?.content;
      return `**${role}**: ${typeof content === "string" ? content : formatJson(content)}`;
    })
    .join("\n\n");
}

function extractFinalResponse(rootRun: Run): string {
  if (rootRun.outputs) {
    const out = rootRun.outputs as Record<string, unknown>;
    if (out.text && typeof out.text === "string") return out.text;
    if (typeof rootRun.outputs === "string") return rootRun.outputs;
    return formatJson(rootRun.outputs);
  }
  return "(no output recorded)";
}

// ---------------------------------------------------------------------------
// Group runs into execution steps
// ---------------------------------------------------------------------------

type ExecutionStep = {
  stepNumber: number;
  llmRun: Run | null;
  toolRuns: Run[];
};

function buildExecutionSteps(allRuns: Run[]): ExecutionStep[] {
  const llmRuns = allRuns.filter((r) => r.run_type === "llm");
  const toolRuns = allRuns.filter((r) => r.run_type === "tool");

  if (llmRuns.length === 0) {
    if (toolRuns.length === 0) return [];
    return [{ stepNumber: 1, llmRun: null, toolRuns }];
  }

  const steps: ExecutionStep[] = [];

  for (let i = 0; i < llmRuns.length; i++) {
    const llm = llmRuns[i];
    const llmTime = new Date(llm.start_time ?? 0).getTime();
    const nextLlmTime =
      i + 1 < llmRuns.length
        ? new Date(llmRuns[i + 1].start_time ?? 0).getTime()
        : Infinity;

    const stepTools = toolRuns.filter((t) => {
      const time = new Date(t.start_time ?? 0).getTime();
      return time >= llmTime && time < nextLlmTime;
    });

    steps.push({
      stepNumber: i + 1,
      llmRun: llm,
      toolRuns: stepTools,
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Render markdown report
// ---------------------------------------------------------------------------

function renderReport(rootRun: Run, allRuns: Run[]): string {
  const llmRuns = allRuns.filter((r) => r.run_type === "llm");
  const toolRuns = allRuns.filter((r) => r.run_type === "tool");
  const steps = buildExecutionSteps(allRuns);

  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`# AI Trace Review: ${rootRun.trace_id}`);
  push("");

  // -- Metadata --
  push("## Trace Metadata");
  push("");
  push(`| Field | Value |`);
  push(`|-------|-------|`);
  push(`| Trace ID | \`${rootRun.trace_id}\` |`);
  push(`| Name | ${rootRun.name ?? "N/A"} |`);
  push(`| Timestamp | ${rootRun.start_time ?? "N/A"} |`);
  push(`| Latency | ${runLatencyMs(rootRun)} |`);
  push(`| Total Cost | ${rootRun.total_cost != null ? `$${rootRun.total_cost.toFixed(6)}` : "N/A"} |`);
  push(`| Tags | ${rootRun.tags?.join(", ") || "none"} |`);
  push(`| Runs | ${allRuns.length} total (${llmRuns.length} llm, ${toolRuns.length} tool) |`);
  push("");

  // -- System prompt --
  push("## System Prompt");
  push("");
  const systemPrompt = extractSystemPrompt(llmRuns);
  if (systemPrompt) {
    push("```");
    push(systemPrompt);
    push("```");
  } else {
    push("(not found in trace)");
  }
  push("");

  // -- Conversation history --
  const history = extractConversationHistory(llmRuns);
  if (history) {
    push("## Conversation History");
    push("");
    push(history);
    push("");
  }

  // -- User prompt --
  push("## User Prompt");
  push("");
  push("```");
  push(extractUserPrompt(rootRun, llmRuns));
  push("```");
  push("");

  // -- Execution steps --
  push("## Execution Steps");
  push("");

  for (const step of steps) {
    push(`### Step ${step.stepNumber}: LLM Call`);
    push("");

    if (step.llmRun) {
      const llm = step.llmRun;

      push(`| Field | Value |`);
      push(`|-------|-------|`);
      push(`| Model | ${llm.extra?.metadata?.ls_model_name ?? llm.name ?? "N/A"} |`);
      push(`| Prompt tokens | ${llm.prompt_tokens ?? "N/A"} |`);
      push(`| Completion tokens | ${llm.completion_tokens ?? "N/A"} |`);
      push(`| Total tokens | ${(llm.prompt_tokens ?? 0) + (llm.completion_tokens ?? 0) || "N/A"} |`);
      push(`| Latency | ${runLatencyMs(llm)} |`);
      if (llm.first_token_time) {
        const ttft = new Date(llm.first_token_time).getTime() - new Date(llm.start_time ?? 0).getTime();
        push(`| Time to first token | ${ttft}ms |`);
      }
      if (llm.total_cost != null) {
        push(`| Cost | $${llm.total_cost.toFixed(6)} |`);
      }
      push("");

      push("**Messages sent to model:**");
      push("");
      const messages = llm.inputs?.messages;
      if (Array.isArray(messages)) {
        const flat = messages.flat();
        for (const msg of flat as Array<Record<string, unknown>>) {
          const role = msg.type ?? msg.role ?? "unknown";
          const content = msg.content ?? (msg.data as Record<string, unknown>)?.content;
          push(`<details><summary>${role}</summary>`);
          push("");
          push("```");
          push(typeof content === "string" ? content : formatJson(content));
          push("```");
          push("");
          push("</details>");
          push("");
        }
      } else {
        push("```json");
        push(formatJson(llm.inputs));
        push("```");
        push("");
      }

      push("**Model response:**");
      push("");
      push("```json");
      push(formatJson(llm.outputs));
      push("```");
      push("");
    } else {
      push("(no LLM run recorded for this step)");
      push("");
    }

    if (step.toolRuns.length > 0) {
      push(`### Step ${step.stepNumber}: Tool Executions`);
      push("");

      for (const tool of step.toolRuns) {
        push(`#### Tool: \`${tool.name}\``);
        push("");
        push(`- **Latency:** ${runLatencyMs(tool)}`);
        if (tool.error) {
          push(`- **Error:** ${tool.error}`);
        }
        push("");

        push("**Input:**");
        push("");
        push("```json");
        push(formatJson(tool.inputs));
        push("```");
        push("");

        push("**Output:**");
        push("");
        push("```json");
        push(formatJson(tool.outputs));
        push("```");
        push("");
      }
    }
  }

  // -- Final response --
  push("## Final Response");
  push("");
  push("```");
  push(extractFinalResponse(rootRun));
  push("```");
  push("");

  // -- Analysis summary --
  push("## Analysis Summary");
  push("");

  const totalPromptTokens = llmRuns.reduce((s, r) => s + (r.prompt_tokens ?? 0), 0);
  const totalCompletionTokens = llmRuns.reduce((s, r) => s + (r.completion_tokens ?? 0), 0);
  const totalTokens = totalPromptTokens + totalCompletionTokens;

  const toolCallCounts = new Map<string, number>();
  for (const tool of toolRuns) {
    toolCallCounts.set(tool.name, (toolCallCounts.get(tool.name) ?? 0) + 1);
  }

  const usedGetBoardState = toolCallCounts.has("getBoardState");

  push(`| Metric | Value |`);
  push(`|-------|-------|`);
  push(`| Total steps | ${steps.length} |`);
  push(`| Total LLM calls | ${llmRuns.length} |`);
  push(`| Total tool calls | ${toolRuns.length} |`);
  push(`| Total prompt tokens | ${totalPromptTokens} |`);
  push(`| Total completion tokens | ${totalCompletionTokens} |`);
  push(`| Total tokens | ${totalTokens} |`);
  push(`| Total cost | ${rootRun.total_cost != null ? `$${rootRun.total_cost.toFixed(6)}` : "N/A"} |`);
  push(`| Tokens per tool call | ${toolRuns.length > 0 ? Math.round(totalTokens / toolRuns.length) : "N/A"} |`);
  push(`| Called getBoardState | ${usedGetBoardState ? "yes" : "no"} |`);
  push(`| Multi-step | ${toolRuns.length > 1 ? `yes (${toolRuns.length} tool calls)` : "no"} |`);
  push("");

  if (toolCallCounts.size > 0) {
    push("### Tool Call Breakdown");
    push("");
    push("| Tool | Count |");
    push("|------|-------|");
    for (const [name, count] of toolCallCounts) {
      push(`| ${name} | ${count} |`);
    }
    push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Fetching trace ${traceId}...\n`);

  const allRuns = await fetchTraceRuns(traceId);

  if (allRuns.length === 0) {
    console.error(`No runs found for trace ID ${traceId}`);
    process.exitCode = 1;
    return;
  }

  const rootRun = allRuns.find((r) => r.parent_run_id == null) ?? allRuns[0];
  const childRuns = allRuns.filter((r) => r.id !== rootRun.id);

  console.log(
    `Trace found: "${rootRun.name}" with ${allRuns.length} runs ` +
    `(${childRuns.filter((r) => r.run_type === "llm").length} llm, ` +
    `${childRuns.filter((r) => r.run_type === "tool").length} tool).\n`
  );

  const report = renderReport(rootRun, childRuns);

  const ROOT = resolve(process.cwd());
  const artifactDir = join(ROOT, "artifacts");
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "ai-trace-review.md");
  await writeFile(artifactPath, report + "\n");

  console.log(report);
  console.log(`\n---\nArtifact saved to: ${artifactPath}`);
}

main().catch((err) => {
  console.error("AI Trace Review failed:", err);
  process.exitCode = 1;
});
