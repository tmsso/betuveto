// Shared E2E helpers (split out of game.spec.ts for rooms.spec.ts, ROADMAP 7.2.6).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { canFormWord, letterCount, normalizeWord } from '../../lib/words.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MAX_CANDIDATES = 5

export async function loadDictionary(): Promise<string[]> {
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

// Guesses through a short candidate list (see the file-level comment on why more than one
// is tried) until one scores, polling the score's aria-label since a rejected guess never
// moves it. Returns the accepted word, or null if every candidate was rejected.
export async function findAcceptedWord(
  page: Page,
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
