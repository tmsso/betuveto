/**
 * ROADMAP 16.6 — renders docs/play-store/feature-graphic.html to the 1024×500 JPEG Play wants
 * (JPEG: Play rejects PNGs with an alpha channel). Local file only: no network, no data.
 *   npx playwright test -c playwright.assets.config.ts feature-graphic
 * Still guarded by screenshots.spec.ts's PLAY_ASSETS_URL check when run as the whole folder.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PAGE = pathToFileURL(path.join(ROOT, 'docs', 'play-store', 'feature-graphic.html')).href

for (const lang of ['hu', 'en']) {
  test(`feature graphic (${lang})`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 })
    await page.goto(`${PAGE}?lang=${lang}`)
    await page.evaluate(() => document.fonts.ready)
    // Fail rather than ship a fallback font: every face the page declares must have loaded.
    const faces = await page.evaluate(() => [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`))
    expect(faces.filter((f) => !f.endsWith('loaded') && !f.endsWith('unloaded'))).toEqual([])
    expect(await page.evaluate(() => document.fonts.check('700 108px "Baloo 2"', 'Betűvető'))).toBe(true)
    await page.screenshot({
      path: path.join(ROOT, 'docs', 'play-store', `feature-graphic-${lang}.jpg`),
      type: 'jpeg',
      quality: 92,
    })
  })
}
