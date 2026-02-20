/**
 * AI Cost Analysis Script
 *
 * Queries LangSmith for all ai-command traces and LLM runs to produce:
 *  - Development spend totals (tokens, cost, API calls)
 *  - Per-command averages
 *  - Production cost projections at 100 / 1,000 / 10,000 / 100,000 user tiers
 *
 * Output:
 *  - artifacts/ai-cost-analysis.json  (machine-readable)
 *  - stdout markdown summary           (human-readable)
 *
 * Usage:
 *   bun --env-file=.env scripts/ai-cost-analysis.ts
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

const client = new Client();

// ---------------------------------------------------------------------------
// Configurable projection assumptions
// ---------------------------------------------------------------------------
const COMMANDS_PER_USER_PER_SESSION = 10;
const SESSIONS_PER_USER_PER_MONTH = 20;
const USER_TIERS = [100, 1_000, 10_000, 100_000];

// ---------------------------------------------------------------------------
// Fetch all ai-command root traces
// ---------------------------------------------------------------------------

async function fetchAllTraces(): Promise<Run[]> {
  const runs: Run[] = [];
  for await (const run of client.listRuns({
    projectName: PROJECT_NAME,
    isRoot: true,
    filter: 'has(tags, "ai-command")',
  })) {
    runs.push(run);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Fetch all LLM runs across the project for model breakdown
// ---------------------------------------------------------------------------

async function fetchLlmRuns(): Promise<Run[]> {
  const runs: Run[] = [];
  for await (const run of client.listRuns({
    projectName: PROJECT_NAME,
    runType: "llm",
  })) {
    runs.push(run);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching data from LangSmith...\n");

  const [traces, llmRuns] = await Promise.all([
    fetchAllTraces(),
    fetchLlmRuns(),
  ]);

  const commands = traces.length;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;

  const modelStats = new Map<string, {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCost: number;
    count: number;
  }>();

  for (const run of llmRuns) {
    const input = run.prompt_tokens ?? 0;
    const output = run.completion_tokens ?? 0;
    const total = input + output;
    const cost = run.total_cost ?? 0;

    totalInputTokens += input;
    totalOutputTokens += output;
    totalTokens += total;
    totalCost += cost;

    const modelName = (run.extra as Record<string, unknown>)?.metadata
      ? ((run.extra as Record<string, unknown>).metadata as Record<string, unknown>)?.ls_model_name as string ?? run.name
      : run.name;

    const existing = modelStats.get(modelName) ?? {
      model: modelName,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      count: 0,
    };
    existing.inputTokens += input;
    existing.outputTokens += output;
    existing.totalTokens += total;
    existing.totalCost += cost;
    existing.count++;
    modelStats.set(modelName, existing);
  }

  const avgTokensPerCommand = commands > 0 ? totalTokens / commands : 0;
  const avgCostPerCommand = commands > 0 ? totalCost / commands : 0;
  const avgInputTokensPerCommand = commands > 0 ? totalInputTokens / commands : 0;
  const avgOutputTokensPerCommand = commands > 0 ? totalOutputTokens / commands : 0;

  const commandsPerUserPerMonth = COMMANDS_PER_USER_PER_SESSION * SESSIONS_PER_USER_PER_MONTH;
  const projections = USER_TIERS.map((users) => {
    const monthlyCommands = users * commandsPerUserPerMonth;
    const monthlyCost = monthlyCommands * avgCostPerCommand;
    const monthlyTokens = monthlyCommands * avgTokensPerCommand;
    return {
      users,
      monthlyCommands,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      monthlyTokens: Math.round(monthlyTokens),
      costPerUser: Math.round((monthlyCost / users) * 100) / 100,
    };
  });

  const modelBreakdown = Array.from(modelStats.values()).map((m) => ({
    model: m.model,
    totalTokens: m.totalTokens,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    totalCost: Math.round(m.totalCost * 1_000_000) / 1_000_000,
    apiCalls: m.count,
  }));

  const perModelProjections = Array.from(modelStats.values())
    .filter((m) => m.count >= 5)
    .map((m) => {
      const callsPerCommand = m.count / commands;
      const avgCostPerCmd = commands > 0 ? m.totalCost / commands : 0;
      const avgTokensPerCmd = commands > 0 ? m.totalTokens / commands : 0;
      const tiers = USER_TIERS.map((users) => {
        const monthlyCommands = users * commandsPerUserPerMonth;
        const monthlyCost = monthlyCommands * avgCostPerCmd;
        const monthlyTokens = monthlyCommands * avgTokensPerCmd;
        return {
          users,
          monthlyCommands,
          monthlyCost: Math.round(monthlyCost * 100) / 100,
          monthlyTokens: Math.round(monthlyTokens),
          costPerUser: Math.round((monthlyCost / users) * 100) / 100,
        };
      });
      return {
        model: m.model,
        avgCallsPerCommand: Math.round(callsPerCommand * 100) / 100,
        avgCostPerCommand: Math.round(avgCostPerCmd * 1_000_000) / 1_000_000,
        avgTokensPerCommand: Math.round(avgTokensPerCmd),
        projections: tiers,
      };
    });

  const artifact = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      commandsPerUserPerSession: COMMANDS_PER_USER_PER_SESSION,
      sessionsPerUserPerMonth: SESSIONS_PER_USER_PER_MONTH,
    },
    devSpend: {
      totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalApiCalls: llmRuns.length,
      totalCommands: commands,
    },
    perCommand: {
      avgTokens: Math.round(avgTokensPerCommand),
      avgInputTokens: Math.round(avgInputTokensPerCommand),
      avgOutputTokens: Math.round(avgOutputTokensPerCommand),
      avgCost: Math.round(avgCostPerCommand * 1_000_000) / 1_000_000,
    },
    modelBreakdown,
    projections,
    perModelProjections,
  };

  const ROOT = resolve(process.cwd());
  const artifactDir = join(ROOT, "artifacts");
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "ai-cost-analysis.json");
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n");

  const md = `
# AI Cost Analysis Report

Generated: ${artifact.generatedAt}

## Development Spend

| Metric | Value |
|--------|-------|
| Total cost | $${artifact.devSpend.totalCost.toFixed(6)} |
| Total tokens | ${artifact.devSpend.totalTokens.toLocaleString()} |
| Input tokens | ${artifact.devSpend.totalInputTokens.toLocaleString()} |
| Output tokens | ${artifact.devSpend.totalOutputTokens.toLocaleString()} |
| Total API calls | ${artifact.devSpend.totalApiCalls.toLocaleString()} |
| Total AI commands | ${artifact.devSpend.totalCommands.toLocaleString()} |

## Per-Command Averages

| Metric | Value |
|--------|-------|
| Avg tokens/command | ${artifact.perCommand.avgTokens.toLocaleString()} |
| Avg input tokens | ${artifact.perCommand.avgInputTokens.toLocaleString()} |
| Avg output tokens | ${artifact.perCommand.avgOutputTokens.toLocaleString()} |
| Avg cost/command | $${artifact.perCommand.avgCost.toFixed(6)} |

## Model Breakdown

| Model | Input Tokens | Output Tokens | Total Tokens | Cost | API Calls |
|-------|-------------|---------------|-------------|------|-----------|
${modelBreakdown.map((m) => `| ${m.model} | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | ${m.totalTokens.toLocaleString()} | $${m.totalCost.toFixed(6)} | ${m.apiCalls.toLocaleString()} |`).join("\n")}

## Production Cost Projections (Blended Average)

Assumptions: ${COMMANDS_PER_USER_PER_SESSION} commands/session, ${SESSIONS_PER_USER_PER_MONTH} sessions/month

| Users | Monthly Commands | Monthly Cost | Monthly Tokens | Cost/User |
|-------|-----------------|--------------|----------------|-----------|
${projections.map((p) => `| ${p.users.toLocaleString()} | ${p.monthlyCommands.toLocaleString()} | $${p.monthlyCost.toFixed(2)} | ${p.monthlyTokens.toLocaleString()} | $${p.costPerUser.toFixed(2)} |`).join("\n")}

## Production Cost Projections by Model

${perModelProjections.map((mp) => `### ${mp.model}

Avg cost/command: $${mp.avgCostPerCommand.toFixed(6)} | Avg tokens/command: ${mp.avgTokensPerCommand.toLocaleString()} | Avg calls/command: ${mp.avgCallsPerCommand}

| Users | Monthly Commands | Monthly Cost | Cost/User |
|-------|-----------------|--------------|-----------|
${mp.projections.map((p) => `| ${p.users.toLocaleString()} | ${p.monthlyCommands.toLocaleString()} | $${p.monthlyCost.toFixed(2)} | $${p.costPerUser.toFixed(2)} |`).join("\n")}
`).join("\n")}
---
Artifact saved to: ${artifactPath}
`;

  console.log(md);
}

main().catch((err) => {
  console.error("AI Cost Analysis failed:", err);
  process.exit(1);
});
