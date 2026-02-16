import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { inArray } from "drizzle-orm";

import { pool, db } from "../db/client";
import { user, verification } from "../db/schema";
import { perfUsers } from "./perf-users";

const PERF_USERS_ARTIFACT = resolve(process.cwd(), "../../artifacts/perf/perf-users.json");

async function main() {
  const emails = perfUsers.map((entry) => entry.email);
  await db.delete(verification).where(inArray(verification.identifier, emails));
  await db.delete(user).where(inArray(user.email, emails));
  await unlink(PERF_USERS_ARTIFACT).catch(() => {});
  console.info(`[perf-users] cleaned ${emails.length} users`);
}

main()
  .catch((error) => {
    console.error("[perf-users] cleanup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
