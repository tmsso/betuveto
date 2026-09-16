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

// Shared by every test below: mint an identity (CI's pinned player when available) and
// press "Új játék", the pre-game board's only control (ROADMAP Batch 10 item 17). Returns
// the started board's own letters, read off the rendered <button>s.
async function startGame(page: import('@playwright/test').Page): Promise<string> {
  if (CI_PLAYER_COOKIE) {
    const baseURL = test.info().project.use.baseURL
    if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL for cookie scoping.')
    await page.context().addCookies([
      { name: 'bv_anon', value: CI_PLAYER_COOKIE, url: baseURL },
    ])
  }

  await page.goto('/')
  // Pre-game the board holds plain <div> placeholder tiles, so the real letter <button>s
  // appear only once the game has started.
  await page.getByRole('button', { name: 'Új játék', exact: true }).click()

  const board = page.getByRole('group', { name: 'Kirakható betűk' })
  await expect(board).toBeVisible()
  await expect(board.getByRole('button').first()).toBeVisible()
  const letters = (await board.getByRole('button').allTextContents()).join('')
  expect(letters.length).toBeGreaterThan(0)
  return letters
}

// Guesses through a short candidate list (see the file-level comment on why more than one
// is tried) until one scores, polling the score's aria-label since a rejected guess never
// moves it. Returns the accepted word, or null if every candidate was rejected.
async function findAcceptedWord(
  page: import('@playwright/test').Page,
  dictionary: string[],
  letters: string,
): Promise<string | null> {
  const candidates = dictionary
    .filter((word) => letterCount(word) <= letters.length && canFormWord(word, letters))
    .slice(0, MAX_CANDIDATES)
  expect(candidates, `no findable word for board "${letters}" in the local dictionary`).not.toHaveLength(0)

  const score = page.getByLabel(/^Pontszám:/)
  const guessInput = page.getByLabel('Tipp beírása')
  const scoreBefore = (await score.getAttribute('aria-label')) || ''

  for (const candidate of candidates) {
    await guessInput.fill(candidate)
    await page.getByLabel('Tipp beküldése').click()

    let moved = false
    for (let i = 0; i < 10 && !moved; i++) {
      await page.waitForTimeout(200)
      moved = (await score.getAttribute('aria-label')) !== scoreBefore
    }
    if (moved) return candidate
    await guessInput.fill('')
  }
  return null
}

test('start a game, guess a word, and see the score update', async ({ page }) => {
  const dictionary = await loadDictionary()
  const letters = await startGame(page)

  const accepted = await findAcceptedWord(page, dictionary, letters)
  expect(accepted, `none of the wordlist-file candidates were accepted by the live dictionary`).not.toBeNull()

  // A correct guess adds the word to "Talált szavak".
  await expect(page.getByRole('heading', { name: 'Talált szavak:' })).toBeVisible()
  // Rendered as "WORD (N pont)" in one text node, so this is a substring match.
  await expect(page.getByText(accepted!, { exact: false }).first()).toBeVisible()
})

// ROADMAP 7.2.1 — extended before the useGame extraction, as a regression net for the
// three classes of bug a hook extraction can cause in this codebase (a duplicated setter
// block drifting from its original, a dropped side effect, a dependency-array mistake
// reintroducing the item-15 language-switch bug). All three must stay green through and
// after the extraction with no changes to this file.
test('reveals a hint and deducts its cost from the displayed score', async ({ page }) => {
  const dictionary = await loadDictionary()
  const letters = await startGame(page)
  // Score a word first: displayScore floors at 0 (lib/game.ts's effectiveScore does the
  // same server-side), so a hint's deduction is only observable once there's something to
  // deduct from.
  const accepted = await findAcceptedWord(page, dictionary, letters)
  expect(accepted, `none of the wordlist-file candidates were accepted by the live dictionary`).not.toBeNull()

  const score = page.getByLabel(/^Pontszám:/)
  const scoreBefore = (await score.getAttribute('aria-label')) || ''

  await page.getByRole('button', { name: /Segítség/ }).click()

  // handleUseHint's success path sets hintMessage, rendered as its own role="status" live
  // region (distinct from the guess-error role="alert" overlay).
  await expect(page.getByRole('status').filter({ hasText: 'betűs szó eleje' })).toBeVisible()
  await expect(score).not.toHaveAttribute('aria-label', scoreBefore)
})

test('gives up, reveals the solution, and leaves the board ready for another game', async ({ page }) => {
  await startGame(page)

  // handleGiveUp gates on window.confirm() before calling the API.
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /Feladom/ }).click()

  // showTemporaryError renders the reveal as a role="alert" overlay (errors.revealed).
  await expect(page.getByRole('alert').filter({ hasText: 'A teljes szó:' })).toBeVisible()

  // The give-up/hint row is gated on `!isTimeUp` — its disappearance confirms the game
  // actually transitioned to ended, not just that the reveal toast happened to render.
  await expect(page.getByRole('button', { name: /Feladom/ })).toHaveCount(0)

  // "Új játék" stays usable (it isn't gated on game state) — starting fresh after a
  // give-up must still work, not just look clickable.
  const startButton = page.getByRole('button', { name: 'Új játék', exact: true })
  await expect(startButton).toBeEnabled()
  await startButton.click()
  const board = page.getByRole('group', { name: 'Kirakható betűk' })
  await expect(board.getByRole('button').first()).toBeVisible()
})

test('switching UI language mid-game leaves the board and the game untouched', async ({ page }) => {
  const letters = await startGame(page)

  const startCalls: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/game/start') || req.url().includes('/daily/start')) {
      startCalls.push(req.url())
    }
  })

  // Bug found in production CI, 2026-09-16 (betuveto-ci-e2e-github-actions-flake memory):
  // handleLanguageChange's setPreferredLanguage call is real, so this test durably wrote
  // preferred_language='en' to whichever identity is active — and CI reuses one pinned
  // identity across every run forever (ROADMAP Batch 10 item 11), so one green run here
  // silently contaminated every CI run after it, on every PR, until this was traced. A
  // try/finally restore isn't enough — it wouldn't run if an assertion above it throws.
  // Stubbing the PATCH instead means this test can never persist a language preference,
  // pass or fail, without needing the real API to cooperate.
  await page.route('**/api/v1/me/preferences', (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    return route.continue()
  })

  await page.getByRole('button', { name: 'Beállítások', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByLabel('Felület nyelvének kiválasztása').selectOption('en')

  // The UI actually switched (not a no-op) — the settings dialog itself re-renders in
  // English once i18n.changeLanguage resolves.
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // The in-progress game must be completely unaffected: same board, and — this is the
  // regression this test exists for (ROADMAP Batch 10 item 15) — no new game/start call.
  // Not `getByRole('group', { name: 'Kirakható betűk' })` here: that accessible name is
  // itself a translated string, and has just changed along with everything else — the
  // board is the only role="group" element on the page, so no name filter is needed.
  const boardAfter = page.getByRole('group')
  const lettersAfter = (await boardAfter.getByRole('button').allTextContents()).join('')
  expect(lettersAfter).toBe(letters)
  expect(startCalls).toHaveLength(0)

  // English copy now renders for the rest of the page too, e.g. the start/new-game button.
  await expect(page.getByRole('button', { name: 'New game', exact: true })).toBeVisible()
})
