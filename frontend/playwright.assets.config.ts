// Store-listing screenshot generator (ROADMAP 16.6), kept apart from the E2E suite so CI never
// runs it: it writes players, games and a room. Target = PLAY_ASSETS_URL (a PR preview).
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './play-assets',
  timeout: 600_000,
  workers: 1,
})
