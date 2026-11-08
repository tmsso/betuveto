// Renders the PNG icons + og image in frontend/public/ from the outlined brand SVGs in
// docs/design/brand/ (design handback §1.4, §7). One-off: re-run after the logo changes.
//   node frontend/scripts/render-brand-assets.mjs
// Headless Chromium (already a dev dependency via Playwright) is the rasteriser, so the
// output matches what browsers draw — no extra image library needed.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const brand = join(here, '../../docs/design/brand')
const pub = join(here, '../public')
const svg = (f) => readFileSync(join(brand, f), 'utf8')
const TEAL = '#0b6b6b'

// [file, size, html body] — each body fills a size×size box.
const fill = (inner, bg = 'transparent', pad = 0) =>
  `<div style="width:100%;height:100%;background:${bg};display:flex;align-items:center;justify-content:center;padding:${pad}%;box-sizing:border-box">${inner.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div>`

const icons = [
  ['favicon-16x16.png', 16, fill(svg('logo-mark.svg'))],
  ['favicon-32x32.png', 32, fill(svg('logo-mark.svg'))],
  // iOS masks its own rounded corners and ignores transparency — give it a full teal ground.
  ['apple-touch-icon.png', 180, fill(svg('logo-mark-on-brand.svg'), TEAL, 14)],
  ['pwa-192x192.png', 192, fill(svg('logo-mark-on-brand.svg'), TEAL, 14)],
  ['pwa-512x512.png', 512, fill(svg('logo-mark-on-brand.svg'), TEAL, 14)],
  ['maskable-512x512.png', 512, fill(svg('logo-maskable.svg'))],
]

// og:image (1200×630): teal ground, faint tiles, stacked mark + wordmark, tagline, tile row.
const tiles = [...'KELESZTŐ'].map((l) =>
  `<span style="width:64px;height:64px;border-radius:14px;background:#fbf3df;box-shadow:inset 0 -5px 0 #c9b27e;display:inline-flex;align-items:center;justify-content:center;font:800 38px 'Baloo 2';color:#1b2a30">${l}</span>`).join('')
const og = `
<div style="width:1200px;height:630px;background:${TEAL};position:relative;overflow:hidden;font-family:Nunito;color:#fff">
  <div style="position:absolute;inset:0;background-image:url('data:image/svg+xml;utf8,${encodeURIComponent(scatter())}')"></div>
  <div style="position:absolute;left:80px;top:70px;display:flex;align-items:center;gap:28px">
    <div style="width:120px;height:120px">${svg('logo-mark-on-brand.svg').replace('<svg ', '<svg style="width:100%;height:100%" ')}</div>
    <div style="height:112px">${svg('logo-wordmark-on-brand.svg').replace('<svg ', '<svg style="height:100%;width:auto" ')}</div>
  </div>
  <p style="position:absolute;left:84px;top:250px;margin:0;font:700 40px Nunito;max-width:900px;line-height:1.25">Rakj ki minél több szót a megkevert betűkből.</p>
  <div style="position:absolute;left:84px;top:370px;display:flex;gap:12px">${tiles}</div>
  <span style="position:absolute;left:84px;bottom:64px;background:#f2a516;color:#1b2a30;font:800 26px Nunito;padding:10px 24px;border-radius:999px">Napi rejtvény · Ranglista · Szoba</span>
  <span style="position:absolute;right:80px;bottom:72px;font:700 26px Nunito;opacity:.85">betuveto.tmsso.com</span>
</div>`

function scatter() {
  // Deterministic pseudo-random tiles (same image every run).
  let seed = 7; const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  let out = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">'
  for (let i = 0; i < 22; i++) {
    const x = r() * 1200, y = r() * 630, a = (r() - 0.5) * 36
    out += `<rect x="${x}" y="${y}" width="64" height="64" rx="14" fill="rgb(255 255 255 / .06)" transform="rotate(${a} ${x + 32} ${y + 32})"/>`
  }
  return out + '</svg>'
}

// Each fontsource file is one subset; declare both with their unicode-range so ASCII comes
// from "latin" and ő/ű from "latin-ext" (without ranges the last face would claim everything).
const RANGES = { latin: 'U+0000-00FF,U+2000-206F', 'latin-ext': 'U+0100-024F,U+1E00-1EFF' }
const fontCss = [['nunito', 'Nunito', 700], ['nunito', 'Nunito', 800], ['baloo-2', 'Baloo 2', 800]]
  .flatMap(([pkg, fam, w]) => Object.entries(RANGES).map(([sub, range]) => {
    const b64 = readFileSync(join(here, `../node_modules/@fontsource/${pkg}/files/${pkg}-${sub}-${w}-normal.woff2`)).toString('base64')
    return `@font-face{font-family:'${fam}';font-weight:${w};unicode-range:${range};src:url(data:font/woff2;base64,${b64})}`
  })).join('')

const browser = await chromium.launch()
for (const [file, size, body] of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>html,body{margin:0;width:${size}px;height:${size}px}</style>${body}`)
  await page.screenshot({ path: join(pub, file), omitBackground: true })
  await page.close()
}
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(`<style>${fontCss}html,body{margin:0}</style>${og}`)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: join(pub, 'og-image.png') })
await browser.close()
console.log('rendered', icons.length + 1, 'files into', pub)
