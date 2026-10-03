/**
 * ROADMAP 7.2.6 — two browser contexts play one room round per mode: create, join via
 * the invite link, start, one find each, both give up, and both see the ranked reveal.
 *
 * Opt-in: runs only when ROOM_E2E_URL points at a full deployment (frontend + API on one
 * origin, e.g. a PR preview), with VERCEL_AUTOMATION_BYPASS_SECRET for Vercel's preview
 * protection. CI's E2E job serves the local build against the *production* API
 * (playwright.config.ts), which has no rooms routes until this ships — and every run mints
 * two fresh players and writes room data, which belongs on a preview's throwaway branch
 * database, not production. (That also keeps the pinned CI identity out of it: creating or
 * joining a room durably sets the caller's display_name — the PR #75 contamination class.)
 *
 *   ROOM_E2E_URL=https://<preview>.vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=... \
 *     npx playwright test e2e/rooms.spec.ts
 *
 * Or this branch's local build against another preview's API (vite.config.js):
 *   E2E_API_TARGET=https://<preview>.vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=... \
 *     ROOM_E2E_URL=http://localhost:4173 npx playwright test e2e/rooms.spec.ts
 *
 * Before pointing this at any preview, confirm that preview's DATABASE_URL is a branch
 * database, not production: a preview whose Neon branch wasn't created falls back to the
 * project-wide Preview value.
 */
import { type Browser, type Page, expect, test } from '@playwright/test'
import { findAcceptedWord, loadDictionary } from './helpers'

const URL = process.env.ROOM_E2E_URL
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

test.skip(!URL, 'ROOM_E2E_URL not set — room E2E runs against a deployed preview only.')

// Hard guard: this spec creates players and rooms, so it must never reach production —
// neither directly nor through the local preview server, whose /api proxy falls back to
// production when E2E_API_TARGET is unset (vite.config.js). Learned the hard way: an empty
// E2E_API_TARGET once sent a run's rooms to production.
const PRODUCTION = 'betuveto.vercel.app'
if (URL) {
  const viaLocalProxy = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(URL)
  const apiTarget = viaLocalProxy ? process.env.E2E_API_TARGET : URL
  if (!apiTarget || apiTarget.includes(PRODUCTION)) {
    throw new Error(
      `rooms.spec.ts refuses to run against production (API target: ${apiTarget || 'unset → production'}).`,
    )
  }
}

async function newPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    locale: 'hu-HU',
    extraHTTPHeaders: BYPASS
      ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' }
      : {},
  })
  return context.newPage()
}

async function boardLetters(page: Page): Promise<string> {
  const board = page.getByRole('group', { name: 'Kirakható betűk' })
  await expect(board.getByRole('button').first()).toBeVisible({ timeout: 15_000 })
  return (await board.getByRole('button').allTextContents()).join('')
}

async function giveUp(page: Page) {
  await page.getByRole('button', { name: /Feladom \(megoldás/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Feladom', exact: true }).click()
}

for (const mode of ['coop', 'versus'] as const) {
  test(`room round (${mode}): create, join by link, start, find, reveal`, async ({ browser }) => {
    test.setTimeout(120_000)
    const dictionary = await loadDictionary()
    const host = await newPlayer(browser)
    const guest = await newPlayer(browser)

    // Host creates the room from the settings drawer.
    await host.goto(URL!)
    await host.getByRole('button', { name: /Beállítások/ }).click()
    const settings = host.getByRole('dialog')
    await settings.getByLabel('Neved').fill('Anna')
    await settings.getByLabel(mode === 'coop' ? /Együtt/ : /Egymás ellen/).check()
    await settings.getByRole('button', { name: 'Szoba létrehozása' }).click()
    const lobby = host.getByTestId('room-lobby')
    await expect(lobby).toBeVisible()
    const code = (await lobby.getByLabel(/^Szobakód:/).textContent())!.trim()
    expect(code).toMatch(/^[A-Z0-9]{6}$/)

    // Guest joins through the invite link.
    await guest.goto(`${URL}/?room=${code}`)
    const invite = guest.getByTestId('room-invite')
    await invite.getByLabel('Neved').fill('Béla')
    await invite.getByRole('button', { name: 'Csatlakozás' }).click()
    await expect(guest.getByTestId('room-lobby')).toContainText('Anna')

    // The host sees the guest arrive (via polling) and starts.
    await expect(lobby).toContainText('Béla', { timeout: 10_000 })
    await host.getByRole('button', { name: 'Indítás' }).click()

    // Both boards appear — the guest's purely from polling — with the same letters.
    const [hostLetters, guestLetters] = await Promise.all([boardLetters(host), boardLetters(guest)])
    expect([...hostLetters].sort().join('')).toBe([...guestLetters].sort().join(''))
    await expect(host.getByText(`${mode === 'versus' ? '⚔️' : '👥'} ${code}`)).toBeVisible()

    // One find each; the other side's strip shows it.
    expect(await findAcceptedWord(host, dictionary, hostLetters)).not.toBeNull()
    expect(await findAcceptedWord(guest, dictionary, guestLetters)).not.toBeNull()
    const guestRow = host.getByTestId('room-strip').getByRole('listitem').filter({ hasText: 'Béla' })
    // At least one find, not exactly one: findAcceptedWord moves on to the next candidate
    // when the score is slow to update, so it can land two (seen 2026-10-03 on a preview).
    await expect(guestRow).toContainText(/(^|\D)[1-9]\d*\/\d/, { timeout: 10_000 })
    if (mode === 'coop') await expect(host.getByTestId('room-strip')).toContainText('Csapat:')
    else await expect(host.getByTestId('room-strip')).not.toContainText('Csapat:')

    // Guest gives up first: no answers yet (D9); the host giving up ends the room.
    await giveUp(guest)
    await expect(guest.getByRole('alert').filter({ hasText: 'Feladtad' })).toBeVisible()
    await giveUp(host)

    for (const page of [host, guest]) {
      const results = page.getByTestId('room-results')
      await expect(results).toBeVisible({ timeout: 15_000 })
      await expect(results).toContainText('Anna')
      await expect(results).toContainText('Béla')
      await expect(results).toContainText('A teljes szó:')
      if (mode === 'versus') await expect(results).toContainText('🏆')
    }

    // Rematch: the host opens a new lobby, the guest follows the pointer.
    await host.getByRole('button', { name: 'Visszavágó' }).click()
    await expect(host.getByTestId('room-lobby')).toBeVisible()
    await guest.getByRole('button', { name: 'Csatlakozás a visszavágóhoz' }).click({ timeout: 15_000 })
    await expect(guest.getByTestId('room-lobby')).toContainText('Anna')
  })
}
