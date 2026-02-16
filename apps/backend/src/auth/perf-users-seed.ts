import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { eq, inArray } from "drizzle-orm";

import { auth } from "./auth";
import { pool, db } from "../db/client";
import { user, verification } from "../db/schema";
import { perfUsers, perfUserPassword } from "./perf-users";

const PERF_ARTIFACTS_DIR = resolve(process.cwd(), "../../artifacts/perf");
const PERF_USERS_ARTIFACT = resolve(PERF_ARTIFACTS_DIR, "perf-users.json");

async function cleanupPerfUsers() {
  const emails = perfUsers.map((entry) => entry.email);
  await db.delete(verification).where(inArray(verification.identifier, emails));
  await db.delete(user).where(inArray(user.email, emails));
}

async function main() {
  await cleanupPerfUsers();

  for (const perfUser of perfUsers) {
    await auth.api.signUpEmail({
      body: {
        email: perfUser.email,
        name: perfUser.name,
        password: perfUserPassword
      }
    });
  }

  for (const perfUser of perfUsers) {
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, perfUser.email));
  }

  await mkdir(PERF_ARTIFACTS_DIR, { recursive: true });
  await writeFile(
    PERF_USERS_ARTIFACT,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        users: perfUsers.map((entry) => ({ ...entry, password: perfUserPassword }))
      },
      null,
      2
    ),
    "utf8"
  );

  console.info(`[perf-users] seeded ${perfUsers.length} users -> ${PERF_USERS_ARTIFACT}`);
}

main()
  .catch((error) => {
    console.error("[perf-users] seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
