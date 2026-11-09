// Betűvető brand palette — the single source for the hex values that go into
// frontend/src/index.css, the theme-color meta, the PWA manifest and the brand assets.
// See docs/design-handback.md §2.
//
//   node docs/design/palette.mjs              # check every pair, exit 1 on any AA failure
//   node docs/design/palette.mjs --markdown   # print the contrast table
//   node docs/design/palette.mjs --css        # print the :root / .dark token blocks (RGB channels)
export const THEMES = {
  light: {
    primary: '#1b2a30', secondary: '#0b6b6b', 'on-secondary': '#ffffff',
    accent: '#b86e00', 'on-accent': '#1b2a30', 'accent-fill': '#f2a516',
    success: '#1d7a45', warning: '#9a5b00', error: '#c0392b',
    paper: '#f4efe4', surface: '#fffdf8', border: '#d9cfbb', muted: '#5b6a6f',
    'success-soft': '#e3f3e8', 'secondary-soft': '#ddefee', 'error-soft': '#fbe7e4', 'warning-soft': '#fdf1d8',
    'tile-face': '#fbf3df', 'tile-edge': '#c9b27e', 'tile-ink': '#1b2a30',
    'tile-used': '#e7e1d4', 'tile-used-ink': '#5b6a6f', 'tile-highlight': '#f2a516',
    'celebrate-1': '#0b6b6b', 'celebrate-2': '#f2a516', 'celebrate-3': '#e0564a',
  },
  dark: {
    primary: '#e4eeec', secondary: '#4cc7bd', 'on-secondary': '#0d1b1f',
    accent: '#f5b83d', 'on-accent': '#0d1b1f', 'accent-fill': '#f5b83d',
    success: '#4ade80', warning: '#fbbf24', error: '#f87171',
    paper: '#0d1b1f', surface: '#142a30', border: '#2b464d', muted: '#9bb0b3',
    'success-soft': '#163a2a', 'secondary-soft': '#123a3a', 'error-soft': '#3d1d1d', 'warning-soft': '#3a2c10',
    'tile-face': '#f3e7c9', 'tile-edge': '#a8925d', 'tile-ink': '#1b2a30',
    'tile-used': '#24393f', 'tile-used-ink': '#9bb0b3', 'tile-highlight': '#f5b83d',
    'celebrate-1': '#4cc7bd', 'celebrate-2': '#f5b83d', 'celebrate-3': '#f07a6e',
  },
}

// [foreground, background, minimum ratio, what it is]
export const PAIRS = [
  ['primary', 'paper', 4.5, 'body text on page'],
  ['primary', 'surface', 4.5, 'body text on card'],
  ['muted', 'surface', 4.5, 'secondary text on card'],
  ['muted', 'paper', 4.5, 'secondary text on page'],
  ['secondary', 'surface', 4.5, 'link / brand text on card'],
  ['on-secondary', 'secondary', 4.5, 'primary button label'],
  ['on-accent', 'accent-fill', 4.5, 'accent chip label'],
  ['accent', 'surface', 3, 'accent large text / icon on card'],
  ['success', 'surface', 3, 'success large text / icon'],
  ['on-secondary', 'success', 3, 'submit button label (bold, large)'],
  ['error', 'surface', 4.5, 'error text on card'],
  ['warning', 'surface', 4.5, 'warning text on card'],
  ['primary', 'success-soft', 4.5, 'found-word chip'],
  ['primary', 'secondary-soft', 4.5, 'teammate chip / badge'],
  ['primary', 'warning-soft', 4.5, 'hint / achievement note'],
  ['primary', 'error-soft', 4.5, 'error note'],
  ['tile-ink', 'tile-face', 4.5, 'letter on tile'],
  ['tile-used-ink', 'tile-used', 3, 'letter on used tile (disabled, large)'],
  ['tile-edge', 'surface', 1.8, 'tile bevel against card (decorative)'],
]

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
export const rgbChannels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ')

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = 0
  const rows = []
  for (const [fg, bg, min, what] of PAIRS) {
    const cells = Object.entries(THEMES).map(([name, th]) => {
      const r = contrast(th[fg], th[bg])
      if (r < min) { failed++; console.error(`FAIL ${name}: ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`) }
      return `${th[fg]} / ${th[bg]} **${r.toFixed(2)}**`
    })
    rows.push(`| ${what} | \`${fg}\` on \`${bg}\` | ${min}:1 | ${cells.join(' | ')} |`)
  }
  if (process.argv.includes('--markdown')) {
    console.log('| Use | Pair | AA min | Light | Dark |\n|---|---|---|---|---|')
    console.log(rows.join('\n'))
  }
  if (process.argv.includes('--css')) {
    for (const [name, th] of Object.entries(THEMES)) {
      console.log(name === 'light' ? ':root {' : '.dark {')
      for (const [k, v] of Object.entries(th)) console.log(`  --game-${k}: ${rgbChannels(v)}; /* ${v} */`)
      console.log('}')
    }
  }
  if (failed) process.exit(1)
  console.error(`all ${PAIRS.length * 2} pairs pass`)
}
