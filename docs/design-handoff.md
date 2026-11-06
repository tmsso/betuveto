# Betűvető — design polish handoff (2026-11-06)

Audience: a designer (human or Claude Design session) producing a refreshed look. Scope is
**visual identity and polish**, not new features or game rules. The output should be specs +
assets that a dev session can implement against the existing token system.

## 1. Where it is today (verified in code)

| Area | Current state | Problem |
|---|---|---|
| Title | Plain `<h1>` text "Betűvető", Baloo 2 extrabold, 5xl, `text-game-primary` (`App.jsx:749`) | Reads as a heading, not a brand. No wordmark, no mark beside it. |
| Logo / icon | `public/pwa-*.png`, maskable, favicons: white rounded square with dark **"BV"** on `#3498db` | Generic, unrelated to the in-app title; the "BV" never appears in the app itself. It is also the og:image (512×512, `twitter:card=summary`). |
| Brand colour | Tokens in `src/index.css` (`--game-secondary` `#2272b8` light / `#60a5fa` dark after #121) — but `theme-color` meta, PWA manifest (`vite.config.js`), the icon and `App.css` focus ring still use the **old `#3498db`** | Three blues in circulation; browser chrome / splash don't match the app. |
| Palette | "Flat UI" set (`#2c3e50`, `#2ecc71`, `#e74c3c`, `#f39c12`) + slate dark mode | Functional, not signature. Tiles and badges bypass tokens with raw Tailwind `blue-100/300/800`, `green-100`, `red-500`, `yellow-400`. |
| Framing in browser | Whole app is one centred card: `max-w-xl`, `border-4`, `shadow-2xl`, on a flat `game-paper` page, vertically centred | On desktop: a small box floating in empty grey; on mobile: the thick border eats width. No background character. |
| Icons | Emoji (❓ ⚙️ 🏆 …) in buttons | Rendering differs per OS; inconsistent weight next to Nunito. |
| Type | Nunito (UI) + Baloo 2 (display), self-hosted, latin-ext | Good base — keep. Weights/sizes are ad hoc. |
| Celebration | `react-canvas-confetti` on a found word / "explosion" (`App.jsx:98–125`), `bounce-in` word chip, CSS `celebrate` keyframe defined but **unused** | Same small burst for everything; no distinct moment for: target word found, all words found, daily solved, room win, new personal best. No score count-up, no end-of-round summary screen with visual payoff. |
| Share | Daily share is text (`dailyShare.js`); link previews show the BV icon | No branded share image. |
| Motion | `prefers-reduced-motion` respected globally — **must stay** | — |

Constraints already established (do not undo): WCAG AA in both themes (16.3, axe E2E in #125),
light/dark/system theme, Hungarian diacritics (ő, ű) in every display face, offline PWA (fonts
self-hosted, no CDN), strict CSP (no inline scripts/styles from third parties), 12-tester Play
closed test coming (screenshots in #126 will need re-shooting after a redesign).

## 2. Asks

### A. Logo system
- A **mark** that works at 16 px favicon → 512 maskable (safe zone: inner 80 %), and a **wordmark**
  "Betűvető" where the accents are a feature, not a rendering risk (idea space: letter tiles,
  a tossed/scattered tile — *vet* = sow/cast; the ű/ő double acute as a motif).
- Lockups: horizontal (mark + wordmark, for the header), stacked (splash/store), mark-only.
- Deliver as SVG (+ PNG exports at the existing filenames in `frontend/public/`).
- Usage rules: min size, clear space, on-light / on-dark / on-brand-colour versions.

### B. Signature palette
- One ownable brand hue (+ one accent) replacing generic Flat-UI blue; map onto the **existing
  token names** (`--game-primary/secondary/success/warning/error/paper/surface/border/muted`)
  for light and dark, plus new tokens for: tile face, tile used, tile highlight, celebration
  (2–3 confetti colours), brand-on-dark.
- Every text/background pair must pass AA (4.5:1 body, 3:1 large/UI); give the contrast table.
- Single source: the same hex goes into `theme-color`, manifest `theme_color/background_color`,
  icons, og image.

### C. Framing in the browser
- Desktop (≥1024 px): what surrounds the game — a subtle patterned / gradient backdrop
  (e.g. faint scattered letter tiles), header outside or inside the card, optional side
  room for leaderboard/daily. Mobile: edge-to-edge, no thick border, safe-area aware.
- Replace `border-4 shadow-2xl` card with a defined elevation scale (2–3 levels).
- Installed-PWA / TWA view (no browser chrome): splash screen and status-bar colour.

### D. Letter tiles & board (the hero element)
- Tile states: idle, hover/focus, pressed, used, hint-reveal (currently yellow ring pulse),
  placeholder pre-game. Physical feel (slight bevel/shadow, Scrabble-like but not a copy).
- Found-word chips and the word list styling.

### E. Celebration moments (missing — biggest gap)
Define a tiered set, each with visual + motion + optional sound cue, all with a
reduced-motion fallback (static colour/glow, no particles):
1. Valid word — small (today's level, maybe tile flip into the list).
2. Target / longest word found — bigger, distinct colour.
3. All words found / board cleared — full-screen moment.
4. Daily puzzle solved — summary card + streak visual; doubles as a **shareable image**.
5. Room: win (versus) / cleared together (co-op) — podium treatment on `RoomResults`.
6. New personal best — badge.
Plus: score count-up animation, end-of-round summary screen layout.

### F. Iconography
- Replace emoji with one icon set (outline, matching Nunito weight) — help, settings, sound
  on/off, theme, leaderboard, stats, share, leave, trophy. Prefer an open-licensed set
  (e.g. Lucide) over custom drawing.

### G. Share & store
- og:image 1200×630 branded (switch to `summary_large_image`).
- Feature graphic 1024×500 + screenshot frames for Play (re-shoot after implementation).

## 3. Deliverables expected back
1. Logo SVGs + PNG exports + usage sheet.
2. Token table (light + dark, hex, contrast ratios) mapped to existing token names.
3. Mockups: mobile 390 px and desktop 1440 px — start screen, in-game, end-of-round, daily
   solved, room results; both themes.
4. Motion spec for the celebration tiers (durations, easing, reduced-motion fallback).
5. Icon list with chosen set.

## 4. Implementation notes for the dev session afterwards (FYI)
- Tokens live in `frontend/src/index.css` + `tailwind.config.js`; dark mode is class-based.
- Clean-up to do anyway: remove legacy hardcoded classes in `App.css` (`.game-*` colours,
  `#3498db` focus ring), route raw `blue-*/green-*/red-*` tile classes through tokens, align
  `theme-color` + manifest.
- Confetti library already present; tiers mainly need distinct configs + triggers in `useGame.js`.
- After the change: re-run the axe E2E (#125) and regenerate Play screenshots (#126 pipeline).
