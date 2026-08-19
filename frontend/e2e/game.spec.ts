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
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { canFormWord, letterCount, normalizeWord } from '../../lib/words.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

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

  await page.goto('/')

  // The game auto-starts on load (no "start" button) — wait for the board to render.
  const board = page.getByRole('group', { name: 'Kirakható betűk' })
  await expect(board).toBeVisible()
  const letters = (await board.getByRole('button').allTextContents()).join('')
  expect(letters.length).toBeGreaterThan(0)

  const target = dictionary.find(
    (word) => letterCount(word) <= letters.length && canFormWord(word, letters),
  )
  expect(target, `no findable word for board "${letters}" in the local dictionary`).toBeTruthy()

  const score = page.getByLabel(/^Pontszám:/)
  const scoreBefore = (await score.getAttribute('aria-label')) || ''

  const guessInput = page.getByLabel('Tipp beírása')
  await guessInput.fill(target!)
  await page.getByLabel('Tipp beküldése').click()

  // A correct guess adds the word to "Talált szavak" and raises the score.
  await expect(page.getByRole('heading', { name: 'Talált szavak:' })).toBeVisible()
  await expect(async () => {
    const scoreAfter = (await score.getAttribute('aria-label')) || ''
    expect(scoreAfter).not.toBe(scoreBefore)
  }).toPass()
  // Rendered as "WORD (N pont)" in one text node, so this is a substring match.
  await expect(page.getByText(target!, { exact: false }).first()).toBeVisible()
})
