/**
 * ROADMAP Batch 10 item 5 — one Playwright smoke test: start game -> guess a word -> see
 * score. Catches the "white screen" class of regression that has already happened once in
 * this repo's history (a byte-offset bug in the local dev toolchain — see this repo's own
 * memory notes — which this test deliberately avoids by running against a built+served
 * bundle via `vite preview`, not `vite dev`).
 *
 * The target word is computed locally the same way tests/contract.test.ts already does:
 * read the board's own letters off the rendered page, then find a real word the board can
 * spell from the shared Hungarian wordlist — deterministic, no server-side knowledge needed.
 *
 * The flat wordlist file and the live `words` table can drift (an admin can delete a row —
 * ROADMAP 5.2 item 1 — without the file changing; this repo already hit exactly this
 * divergence once, PR #27's `total_words` assertion). A single candidate word could
 * therefore be rejected for a reason that has nothing to do with this PR, so this tries a
 * short list of candidates and only fails if every one of them does.
 *
 * ROADMAP Batch 10 item 11: every run of this test plays one real game against
 * production, which used to mint a brand-new anonymous player each time — silently
 * inflating the admin dashboard's games/day and DAU. If `E2E_CI_PLAYER_COOKIE` is set (a
 * GitHub Actions secret holding one pre-signed `bv_anon` cookie for a single player row
 * manually flagged `is_ci = true` in production), every CI run reuses that one identity
 * instead of minting a fresh one, and the dashboard excludes it. Absent locally (a plain
 * `npx playwright test` run falls back to the old fresh-mint behaviour unchanged).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { canFormWord, letterCount, normalizeWord } from '../../lib/words.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MAX_CANDIDATES = 5
const CI_PLAYER_COOKIE = process.env.E2E_CI_PLAYER_COOKIE

async function loadDictionary(): Promise<string[]> {
  const raw = await readFile(path.join(REPO_ROOT, 'data', 'magyar-szavak.txt'), 'utf-8')
  const seen = new Set<string>()
  const words: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const word = normalizeWord(line)
    if (!word || seen.has(word)) continue
    seen.add(word)
    words.push(word)
  }
  return words
}

test('start a game, guess a word, and see the score update', async ({ page }) => {
  const dictionary = await loadDictionary()

  if (CI_PLAYER_COOKIE) {
    const baseURL = test.info().project.use.baseURL
    if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL for cookie scoping.')
    await page.context().addCookies([
      { name: 'bv_anon', value: CI_PLAYER_COOKIE, url: baseURL },
    ])
  }

  await page.goto('/')

  // The game auto-starts on load (no "start" button) — wait for the board to render.
  const board = page.getByRole('group', { name: 'Kirakható betűk' })
  await expect(board).toBeVisible()
  const letters = (await board.getByRole('button').allTextContents()).join('')
  expect(letters.length).toBeGreaterThan(0)

  const candidates = dictionary
    .filter((word) => letterCount(word) <= letters.length && canFormWord(word, letters))
    .slice(0, MAX_CANDIDATES)
  expect(candidates, `no findable word for board "${letters}" in the local dictionary`).not.toHaveLength(0)

  const score = page.getByLabel(/^Pontszám:/)
  const guessInput = page.getByLabel('Tipp beírása')
  const scoreBefore = (await score.getAttribute('aria-label')) || ''

  let accepted: string | null = null
  for (const candidate of candidates) {
    await guessInput.fill(candidate)
    await page.getByLabel('Tipp beküldése').click()

    // Poll briefly for the score to move; a rejected guess (e.g. this candidate has since
    // been removed from the live `words` table — see the file-comment above) never does,
    // so this must have a bounded wait rather than an assertion that throws.
    let moved = false
    for (let i = 0; i < 10 && !moved; i++) {
      await page.waitForTimeout(200)
      moved = (await score.getAttribute('aria-label')) !== scoreBefore
    }
    if (moved) {
      accepted = candidate
      break
    }
    await guessInput.fill('')
  }
  expect(
    accepted,
    `none of the wordlist-file candidates were accepted by the live dictionary: ${candidates.join(', ')}`,
  ).not.toBeNull()

  // A correct guess adds the word to "Talált szavak".
  await expect(page.getByRole('heading', { name: 'Talált szavak:' })).toBeVisible()
  // Rendered as "WORD (N pont)" in one text node, so this is a substring match.
  await expect(page.getByText(accepted!, { exact: false }).first()).toBeVisible()
})
