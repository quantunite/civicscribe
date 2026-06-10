import { defineConfig } from "@playwright/test";

// The e2e suite runs the full mock pipeline: MOCK_MODE=true, isolated DATA_DIR
// (wiped in global-setup) so runs are deterministic.
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3211",
  },
  webServer: {
    // Wipe the e2e data dir BEFORE the server boots: Playwright starts the
    // webServer before globalSetup runs, and the server's readiness probe
    // would otherwise cache a stale db.json into the store singleton.
    command:
      'node -e "require(\'node:fs\').rmSync(\'.data-e2e\', { recursive: true, force: true })" && npm run dev -- --port 3211',
    url: "http://localhost:3211",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      MOCK_MODE: "true",
      DATA_DIR: ".data-e2e",
    },
  },
});
