import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
  probeLatencyMs: {
    cursor: PerfStats;
    object: PerfStats;
  };
};

type BudgetsFile = {
  thresholds: {
    cursorSyncLatencyMs: { p95Max: number };
    objectSyncLatencyMs: { p95Max: number };
    canvasFps: { avgMin: number };
    concurrentUsers: { min: number };
    objectCapacity: { min: number };
    canvasLongFramesPerMinute: { max: number };
    inputToRenderMs: { p95Max: number };
  };
};

type PerfUsersFile = {
  users: Array<{
    email: string;
    password: string;
    name: string;
  }>;
};

const PERF_ROOM_ID = "perf-room";
const ARTIFACTS_DIR = resolve(process.cwd(), "../../artifacts/perf");
const BUDGETS_PATH = resolve(process.cwd(), "../../docs/performance-budgets.json");
const PERF_USERS_PATH = resolve(process.cwd(), "../../artifacts/perf/perf-users.json");

async function signIn(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const signInError = page.getByText("Unable to sign in.");

  try {
    await Promise.race([
      page.waitForURL("**/dashboard**", { timeout: 15_000 }),
      signInError.waitFor({ state: "visible", timeout: 15_000 }).then(() => {
        throw new Error(`Unable to sign in seeded user ${creds.email}`);
      })
    ]);
  } catch {
    const currentURL = page.url();
    throw new Error(`Sign-in did not reach dashboard for ${creds.email}. Current URL: ${currentURL}`);
  }
}

async function joinRoom(page: Page, roomId: string) {
  await page.goto(`/canvas/${roomId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("header strong")).toHaveText(roomId, { timeout: 30_000 });
}

async function createSession(context: BrowserContext, creds: { email: string; password: string }) {
  const page = await context.newPage();
  await signIn(page, creds);
  await joinRoom(page, PERF_ROOM_ID);
  return page;
}

async function getPerfSummary(page: Page): Promise<PerfSummary> {
  return page.evaluate(async () => {
    const perfApi = (window as any).__collabPerf;
    if (!perfApi) {
      throw new Error("Performance API is not available. Ensure perf probes are enabled.");
    }
    return perfApi.getSummary();
  });
}

test("meets core real-time performance budgets with 5 users", async ({ browser }) => {
  const budgets = JSON.parse(await readFile(BUDGETS_PATH, "utf8")) as BudgetsFile;
  const perfUsers = JSON.parse(await readFile(PERF_USERS_PATH, "utf8")) as PerfUsersFile;

  const contexts = await Promise.all(
    Array.from({ length: budgets.thresholds.concurrentUsers.min }).map(() => browser.newContext())
  );

  try {
    const pages: Page[] = [];
    for (let index = 0; index < contexts.length; index++) {
      const context = contexts[index];
      const creds = perfUsers.users[index];
      if (!creds) {
        throw new Error(`Missing seeded perf user for context index ${index}`);
      }
      pages.push(await createSession(context, creds));
    }

    const sourcePage = pages[0];
    const receiverPage = pages[1];

    // Inject 550 synthetic objects on ALL pages (10% above the 500 budget minimum)
    // so every client renders under realistic load during measurements.
    const syntheticCount = budgets.thresholds.objectCapacity.min + 50;
    await Promise.all(
      pages.map((page) =>
        page.evaluate((count) => {
          const perfApi = (window as any).__collabPerf;
          if (perfApi) perfApi.setSyntheticObjectCount(count);
        }, syntheticCount)
      )
    );
    await sourcePage.waitForTimeout(500);

    await sourcePage.evaluate(async () => {
      const perfApi = (window as any).__collabPerf;
      if (!perfApi) throw new Error("Missing perf API on source page.");
      await perfApi.runPanZoomScript(6000);
      await perfApi.runInteractionScript(180);
      await perfApi.sendCursorProbe(150);
      await perfApi.sendObjectProbe(150);
    });
    await receiverPage.waitForTimeout(500);

    const receiverSummary = await getPerfSummary(receiverPage);
    const sourceSummary = await getPerfSummary(sourcePage);

    const summary: PerfSummary = {
      canvasFps: receiverSummary.canvasFps,
      canvasLongFramesPerMinute: receiverSummary.canvasLongFramesPerMinute,
      inputToRenderMs: sourceSummary.inputToRenderMs,
      probeLatencyMs: receiverSummary.probeLatencyMs,
    };

    // --- Soft warnings (tracked in artifacts, do not fail CI per performance-budgets.md) ---
    const softWarnings: string[] = [];
    if (summary.canvasLongFramesPerMinute > budgets.thresholds.canvasLongFramesPerMinute.max) {
      softWarnings.push(
        `canvasLongFramesPerMinute: ${summary.canvasLongFramesPerMinute.toFixed(1)} > ${budgets.thresholds.canvasLongFramesPerMinute.max}`
      );
    }
    if (summary.probeLatencyMs.cursor.p99 > 75) {
      softWarnings.push(
        `cursorSyncLatencyMs.p99: ${summary.probeLatencyMs.cursor.p99} > 75`
      );
    }
    if (summary.probeLatencyMs.object.p99 > 150) {
      softWarnings.push(
        `objectSyncLatencyMs.p99: ${summary.probeLatencyMs.object.p99} > 150`
      );
    }
    if (softWarnings.length > 0) {
      console.warn(`[perf] soft budget warnings:\n  ${softWarnings.join("\n  ")}`);
    }

    await mkdir(ARTIFACTS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const artifactPath = resolve(ARTIFACTS_DIR, `frontend-perf-${timestamp}.json`);
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          concurrentUsers: contexts.length,
          syntheticObjectCount: syntheticCount,
          summary,
          softWarnings: softWarnings.length > 0 ? softWarnings : undefined,
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(resolve(ARTIFACTS_DIR, "frontend-perf-latest.json"), JSON.stringify(summary, null, 2), "utf8");

    // --- Hard budgets (fail CI) ---
    expect(summary.canvasFps.avg).toBeGreaterThanOrEqual(budgets.thresholds.canvasFps.avgMin);
    expect(summary.probeLatencyMs.cursor.p95).toBeLessThanOrEqual(
      budgets.thresholds.cursorSyncLatencyMs.p95Max
    );
    expect(summary.probeLatencyMs.object.p95).toBeLessThanOrEqual(
      budgets.thresholds.objectSyncLatencyMs.p95Max
    );
    expect(summary.inputToRenderMs.p95).toBeLessThanOrEqual(
      budgets.thresholds.inputToRenderMs.p95Max
    );
    expect(summary.probeLatencyMs.cursor.count).toBeGreaterThan(50);
    expect(summary.probeLatencyMs.object.count).toBeGreaterThan(50);
    expect(summary.inputToRenderMs.count).toBeGreaterThan(50);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
