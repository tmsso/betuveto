import { defineConfig } from "vitest/config";

// Scoped explicitly rather than relying on Vitest's default recursive
// `**/*.{test,spec}.*` glob — that default also matches
// frontend/e2e/*.spec.ts (ROADMAP Batch 10 item 5's Playwright suite, run by
// `npx playwright test` from frontend/, not vitest), which crashes if vitest
// tries to execute it (`test()` called outside a Playwright test file).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
