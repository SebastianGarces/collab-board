import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type PerfSummary = {
  canvasFps: {
    avg: number;
    sampleCount: number;
  };
  canvasLongFramesPerMinute: number;
  inputToRenderMs: {
    p95: number;
    count: number;
  };
  probeLatencyMs: {
    cursor: {
      p95: number;
      count: number;
    };
  };
};

type BudgetsFile = {
  thresholds: {
    cursorSyncLatencyMs: { p95Max: number };
    canvasFps: { avgMin: number };
    concurrentUsers: { min: number };
    objectCapacity: { min: number };
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
    const pages = [];
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

    await sourcePage.waitForTimeout(500);
    await sourcePage.evaluate(async () => {
      const perfApi = (window as any).__collabPerf;
      if (!perfApi) throw new Error("Missing perf API on source page.");
      perfApi.setSyntheticObjectCount(500);
      await perfApi.runPanZoomScript(6000);
      await perfApi.sendCursorProbe(150);
    });
    await receiverPage.waitForTimeout(500);

    const summary = await getPerfSummary(receiverPage);
    expect(summary.canvasFps.avg).toBeGreaterThanOrEqual(budgets.thresholds.canvasFps.avgMin);
    expect(summary.probeLatencyMs.cursor.p95).toBeLessThanOrEqual(
      budgets.thresholds.cursorSyncLatencyMs.p95Max
    );
    expect(summary.probeLatencyMs.cursor.count).toBeGreaterThan(50);

    await mkdir(ARTIFACTS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const artifactPath = resolve(ARTIFACTS_DIR, `frontend-perf-${timestamp}.json`);
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          concurrentUsers: contexts.length,
          syntheticObjectCount: budgets.thresholds.objectCapacity.min,
          summary
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(resolve(ARTIFACTS_DIR, "frontend-perf-latest.json"), JSON.stringify(summary, null, 2), "utf8");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
