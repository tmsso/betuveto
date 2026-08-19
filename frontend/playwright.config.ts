import { defineConfig } from '@playwright/test'

// ROADMAP Batch 10 item 5 — one smoke test: start game -> guess a word -> see score.
// `webServer` builds and serves this PR's own bundle via `vite preview` (a static-file
// server, so the local `vite dev` byte-offset bug can't apply — see vite.config.js's
// `preview.proxy` comment) rather than testing against a deployed preview, which sits
// behind Vercel's SSO wall in this project and would need a repo secret this CI doesn't
// have. `/api` calls proxy through to the real, live production API.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173',
    // Pinned rather than left to the runner's default locale (ROADMAP 6.2: UI language
    // falls back to navigator.language when there's no saved preference) — a CI runner's
    // locale is an environment detail this test shouldn't depend on.
    locale: 'hu-HU',
  },
})
