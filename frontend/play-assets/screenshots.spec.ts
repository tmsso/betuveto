/**
 * ROADMAP 16.6 — Google Play listing screenshots, re-runnable for later releases.
 * NOT part of the E2E suite (own config: playwright.assets.config.ts, never run by CI).
 *
 *   PLAY_ASSETS_URL=<preview URL> VERCEL_AUTOMATION_BYPASS_SECRET=... \
 *     npx playwright test -c playwright.assets.config.ts
 *
 * Writes docs/play-store/screenshots/<hu|en>/NN-<screen>.jpg at 1080×1920 (a 360×640 CSS
 * viewport at device scale 3): Play's portrait size for games, and JPEG because Play rejects
 * PNGs with an alpha channel. It creates players, games, a daily result and a room, so it
 * refuses production outright. Only made-up names appear (Anna, Bence), and no leaderboard is
 * shot: a preview DB is a copy of production, so leaderboards would show real players' names.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, type Page, expect, test } from '@playwright/test'
import { canFormWord, letterCount, normalizeWord } from '../../lib/words.js'

const URL = process.env.PLAY_ASSETS_URL
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const PRODUCTIONS = ['betuveto.tmsso.com', 'betuveto.vercel.app']
if (!URL || PRODUCTIONS.some((host) => URL.includes(host)) || /localhost|127\.0\.0\.1/.test(URL)) {
  // localhost is refused too: the local preview server proxies /api to production by default.
  throw new Error(`play-assets refuses this target (writes data): ${URL || 'unset'}. Use a PR preview URL.`)
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'docs', 'play-store', 'screenshots')

type Lang = 'hu' | 'en'
const LANGS: { lang: Lang; locale: string; words: string; frequency: string; wordlist: string }[] = [
  { lang: 'hu', locale: 'hu-HU', words: 'magyar-szavak.txt', frequency: 'frequency-hu.tsv', wordlist: 'hu' },
  { lang: 'en', locale: 'en-US', words: 'english-words.txt', frequency: 'frequency-en.tsv', wordlist: 'en' },
]

// Labels come from the app's own locale files, so one flow drives both languages.
function translator(lang: Lang) {
  const dict = JSON.parse(readFileSync(path.join(ROOT, 'frontend/src/i18n/locales', `${lang}.json`), 'utf-8'))
  return (key: string, vars: Record<string, string> = {}): string => {
    const value = key.split('.').reduce((node, part) => node?.[part], dict) as unknown
    if (typeof value !== 'string') throw new Error(`missing ${lang} string ${key}`)
    return value.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '')
  }
}

// Most common words first (Zipf scores from data/frequency-*.tsv), so the shots show words a
// reader recognises rather than whatever is longest ("VEEPEES"). Unscored words are dropped.
function dictionary(file: string, frequencyFile: string): string[] {
  const zipf = new Map<string, number>()
  for (const line of readFileSync(path.join(ROOT, 'data', frequencyFile), 'utf-8').split(/\r?\n/)) {
    const [word, score] = line.split('\t')
    if (word && score) zipf.set(normalizeWord(word), Number(score))
  }
  const seen = new Set<string>()
  for (const line of readFileSync(path.join(ROOT, 'data', file), 'utf-8').split(/\r?\n/)) {
    const word = normalizeWord(line)
    if (word && zipf.has(word)) seen.add(word)
  }
  return [...seen].sort((a, b) => zipf.get(b)! - zipf.get(a)!)
}

async function player(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({
    locale,
    colorScheme: 'light',
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3,
    extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {},
  })
  return context.newPage()
}

async function shot(page: Page, lang: Lang, name: string) {
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    ;(document.activeElement as HTMLElement | null)?.blur() // no stray focus ring in the shot
  })
  await page.waitForTimeout(900) // let animations settle
  await page.screenshot({ path: path.join(OUT, lang, `${name}.jpg`), type: 'jpeg', quality: 90 })
}

async function boardLetters(page: Page, t: ReturnType<typeof translator>): Promise<string> {
  const board = page.getByRole('group', { name: t('board.ariaLabel') })
  await expect(board.getByRole('button').first()).toBeVisible({ timeout: 30_000 })
  return (await board.getByRole('button').allTextContents()).join('')
}

// Longest words first, so the found-words list looks like a real game. Stops after `want`.
async function findWords(page: Page, t: ReturnType<typeof translator>, words: string[], letters: string, want: number) {
  const candidates = words
    .filter((w) => letterCount(w) >= 4 && letterCount(w) <= letters.length && canFormWord(w, letters))
    .slice(0, 25)
  const score = page.getByLabel(new RegExp(`^${t('score.ariaLabel').split(' ')[0]}`))
  const input = page.getByLabel(t('guessInput.ariaLabel'))
  let found = 0
  for (const word of candidates) {
    if (found >= want) break
    const before = await score.getAttribute('aria-label')
    await input.fill(word)
    await page.getByLabel(t('actions.submitAriaLabel')).click()
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(200)
      if ((await score.getAttribute('aria-label')) !== before) { found++; break }
    }
    await input.fill('')
  }
  expect(found, 'no accepted words on this board').toBeGreaterThan(0)
}

async function chooseWordlist(page: Page, t: ReturnType<typeof translator>, wordlist: string) {
  await page.getByRole('button', { name: t('settings.open') }).first().click()
  await page.getByLabel(t('wordlistSelector.ariaLabel')).selectOption(wordlist)
  await page.keyboard.press('Escape')
}

for (const { lang, locale, words: file, frequency, wordlist } of LANGS) {
  test(`Play screenshots (${lang})`, async ({ browser }) => {
    test.setTimeout(240_000)
    const t = translator(lang)
    const words = dictionary(file, frequency)

    // 01 start screen, 02 a game with a few finds and a guess being typed.
    const solo = await player(browser, locale)
    await solo.goto(URL!)
    await expect(solo.getByRole('button', { name: t('actions.newGame'), exact: true })).toBeVisible({ timeout: 30_000 })
    if (lang !== 'hu') await chooseWordlist(solo, t, wordlist)
    await shot(solo, lang, '01-start')
    await solo.getByRole('button', { name: t('actions.newGame'), exact: true }).click()
    const letters = await boardLetters(solo, t)
    await findWords(solo, t, words, letters, 3)
    const board = solo.getByRole('group', { name: t('board.ariaLabel') })
    await board.getByRole('button').nth(0).click()
    await board.getByRole('button').nth(1).click()
    await shot(solo, lang, '02-game')

    // 03 the daily puzzle with one find.
    const daily = await player(browser, locale)
    await daily.goto(URL!)
    await expect(daily.getByRole('button', { name: t('actions.newGame'), exact: true })).toBeVisible({ timeout: 30_000 })
    if (lang !== 'hu') await chooseWordlist(daily, t, wordlist)
    await daily.getByRole('button', { name: t('settings.open') }).first().click()
    await daily.getByRole('button', { name: t('daily.play') }).click()
    const dailyLetters = await boardLetters(daily, t)
    await findWords(daily, t, words, dailyLetters, 2)
    await shot(daily, lang, '03-daily')

    // 04 a co-op room lobby with two made-up players, 05 the same room mid-game.
    const host = await player(browser, locale)
    const guest = await player(browser, locale)
    await host.goto(URL!)
    await expect(host.getByRole('button', { name: t('actions.newGame'), exact: true })).toBeVisible({ timeout: 30_000 })
    if (lang !== 'hu') await chooseWordlist(host, t, wordlist)
    await host.getByRole('button', { name: t('settings.open') }).first().click()
    const settings = host.getByRole('dialog')
    await settings.getByLabel(t('room.nameLabel')).fill('Anna')
    await settings.getByLabel(new RegExp(t('room.mode.coop.name'))).check()
    await settings.getByRole('button', { name: t('room.create') }).click()
    const lobby = host.getByTestId('room-lobby')
    await expect(lobby).toBeVisible()
    const code = (await lobby.getByLabel(new RegExp(`^${t('room.codeAria', { code: '' }).trim()}`)).textContent())!.trim()
    await guest.goto(`${URL}/?room=${code}`)
    const invite = guest.getByTestId('room-invite')
    await invite.getByLabel(t('room.nameLabel')).fill('Bence')
    await invite.getByRole('button', { name: t('room.join') }).click()
    await expect(lobby).toContainText('Bence', { timeout: 15_000 })
    await shot(host, lang, '04-room-lobby')

    await host.getByRole('button', { name: t('room.start') }).click()
    const [hostLetters, guestLetters] = await Promise.all([boardLetters(host, t), boardLetters(guest, t)])
    // Host first, then the guest from the other end of the list, so their finds don't collide.
    await findWords(host, t, words, hostLetters, 2)
    await findWords(guest, t, [...words].reverse(), guestLetters, 1)
    // The strip updates by polling: wait until both rows show their finds, or the shot shows
    // "0/85" next to a score of 41 (it did on the first run).
    for (const name of ['Anna', 'Bence']) {
      const row = host.getByTestId('room-strip').getByRole('listitem').filter({ hasText: name })
      await expect(row).toContainText(/(^|\D)[1-9]\d*\/\d/, { timeout: 15_000 })
    }
    await shot(host, lang, '05-room-game')
  })
}
