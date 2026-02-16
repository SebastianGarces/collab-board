import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./perf-tests",
  timeout: 120_000,
  expect: {
    timeout: 10_000
  },
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true
  },
  webServer: [
    {
      command: "cd ../backend && bun run dev",
      port: 3000,
      timeout: 120_000,
      reuseExistingServer: true
    },
    {
      command: "NEXT_PUBLIC_ENABLE_PERF_PROBES=1 bun run dev",
      port: 5173,
      timeout: 120_000,
      reuseExistingServer: true
    }
  ]
});
