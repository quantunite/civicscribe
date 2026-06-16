import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Cold dynamic imports of route handlers (the Next + provider module graph)
    // can exceed the 5s default on the first test of an import-heavy file under
    // full-suite load, especially on Windows with on-access AV scanning. Raise
    // the per-test and hook timeouts so those tests are not flaky.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
