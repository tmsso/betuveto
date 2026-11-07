# Betűvető — design handback (2026-11-07)

Answer to [`docs/design-handoff.md`](design-handoff.md). This is the spec a dev session implements
against; the visual reference is the design canvas
**https://claude.ai/artifact/1pt3KPBLj1f7cinoUU4sq1** (private to the owner until shared). Where
this doc and the canvas disagree, **this doc wins**. The canvas still carries earlier
explorations (boards A2 and B2) that were *not* chosen.

Decisions the owner made in review:

- **Mark:** "B·V" on two tossed tiles, scheme **A · overlap o1** (board A3). No accent in the mark.
- **On a brand-teal ground** the mark switches to the **C colouring**: saffron V tile with an ink V.
- **Wordmark:** "Betűvető" in Baloo 2 ExtraBold. The font's own ű/ő double acutes are drawn in saffron.
- **Palette:** tinta-teal `#0b6b6b` + saffron `#f2a516` on warm paper.

Delivered in this commit:

| Path | What |
|---|---|
| `docs/design-handback.md` | this spec |
| `docs/design/palette.mjs` | palette source + WCAG checker (`node docs/design/palette.mjs [--markdown\|--css]`) |
| `docs/design/brand/*.svg` | outlined logo assets (no font dependency) |
| `docs/design/brand/generate.cjs` | regenerates the SVGs from the Baloo 2 font files (`@fontsource/baloo-2`) |

---

## 1. Logo

### 1.1 Assets (`docs/design/brand/`)

| File | Use |
|---|---|
| `logo-mark.svg` (64×64) | mark on light **and** dark grounds; favicon source |
| `logo-mark-on-brand.svg` (64×64) | mark on brand teal (C colouring) |
| `logo-maskable.svg` (512×512) | teal full-bleed, mark inside the 80 % safe zone → `maskable-512x512.png` |
| `logo-wordmark.svg` / `-dark.svg` / `-on-brand.svg` | outlined wordmark: ink / `#e4eeec` / white letters, saffron accents |
| `logo-horizontal.svg` | mark + wordmark, header / docs |
| `logo-stacked-on-brand.svg` | splash / store / feature graphic |

All glyphs are outlined paths, so they render identically everywhere.

### 1.2 Mark geometry (viewBox 0 0 64 64)

Two tiles are drawn back to front. Each tile has these parts:

- an edge rect `s×s` with `rx = 0.24 s`;
- a face rect, the same size but `0.1 s` shorter, giving the bevel at the bottom;
- a letter in Baloo 2 800 at `0.8 s`, centred, with its baseline at `cy − 0.05 s + 0.256 s`.

| Tile | x, y, s | rotate | Light / dark ground | On brand teal |
|---|---|---|---|---|
| V (back) | 28, 7, 31 | +10° about its centre | face `#0b6b6b`, edge `#084f4f`, letter `#f2a516` | face `#f2a516`, edge `#c4830a`, letter `#0d1b1f` |
| B (front) | 4, 25, 32 | −7° about its centre | face `#fbf3df`, edge `#c9b27e`, letter `#0b6b6b` | same |

Rules:

- **Clear space:** half the B tile's width on every side.
- **Minimum size:** the horizontal lockup at 120 px wide; below that, use the mark alone. The mark is legible down to 16 px.
- **Grounds:** the mark is never placed on saffron.

### 1.3 Wordmark in the app (live text, not an image)

The `<h1>` stays real text "Betűvető", so screen readers and the E2E heading lookups keep working. Only
the accents are recoloured, by overlaying a clipped copy of the same glyph. Measured on Baloo 2 800 in a
`line-height: 1` box:

- the accents occupy **0.025–0.247 em** from the top;
- the letter body starts at **0.275 em**.

The clip line is therefore at **0.26 em**.

```html
<h1 class="font-display font-extrabold leading-none">Bet<span class="accented">ű<span aria-hidden="true">ű</span></span>vet<span class="accented">ő<span aria-hidden="true">ő</span></span></h1>
```
```css
.accented { position: relative; display: inline-block; }
.accented > span {
  position: absolute; left: 0; top: 0;
  color: rgb(var(--game-accent-fill));
  -webkit-text-stroke: 0.012em rgb(var(--game-accent-fill)); /* hides the ink fringe under the overlay */
  clip-path: inset(0 0 calc(100% - 0.26em) 0);
}
```

Check that the accessible name of the `<h1>` is still exactly "Betűvető". The overlays are `aria-hidden`.

### 1.4 Where the logo goes

- **Header:** the mark (48 px on desktop, 38 px on mobile) plus the wordmark, inline as an SVG React component (`components/Logo.jsx`) built from `logo-mark.svg`. Pass a prop for the on-brand colouring.
- **Favicons and PWA icons:** render PNGs from the SVGs, keeping the existing filenames in `frontend/public/`: `favicon-16x16`, `favicon-32x32`, `apple-touch-icon` (180, on teal), `pwa-192x192`, `pwa-512x512` and `maskable-512x512`. Chromium + Playwright are available; a one-off script under `scripts/` is fine. Also add an `icon.svg` for `<link rel="icon" type="image/svg+xml">`.

## 2. Palette and tokens

### 2.1 Token values

The single source is `docs/design/palette.mjs`. Paste the output of `node docs/design/palette.mjs --css` into
`frontend/src/index.css`: `:root` holds light, `.dark` holds dark, both as RGB channels, as today.

| Token (`--game-*`) | Light | Dark | Notes |
|---|---|---|---|
| primary | `#1b2a30` | `#e4eeec` | text |
| secondary | `#0b6b6b` | `#4cc7bd` | **brand**: links, primary buttons, focus ring |
| on-secondary *(new)* | `#ffffff` | `#0d1b1f` | label on `secondary` / `success` fills — replaces hardcoded `text-white` |
| accent *(new)* | `#b86e00` | `#f5b83d` | accent as text/icon (≥ 3:1, large/bold only in light) |
| accent-fill *(new)* | `#f2a516` | `#f5b83d` | saffron fills: highlight chip, hint ring, badges |
| on-accent *(new)* | `#1b2a30` | `#0d1b1f` | text on `accent-fill` |
| success | `#1d7a45` | `#4ade80` | |
| warning | `#9a5b00` | `#fbbf24` | |
| error | `#c0392b` | `#f87171` | |
| paper | `#f4efe4` | `#0d1b1f` | page ground |
| surface | `#fffdf8` | `#142a30` | cards, panels |
| border | `#d9cfbb` | `#2b464d` | hairlines |
| muted | `#5b6a6f` | `#9bb0b3` | secondary text |
| success-soft / secondary-soft / warning-soft / error-soft *(new)* | `#e3f3e8` / `#ddefee` / `#fdf1d8` / `#fbe7e4` | `#163a2a` / `#123a3a` / `#3a2c10` / `#3d1d1d` | chip and note grounds (replace `bg-green-100`, `bg-blue-100`, `bg-yellow-50`, `bg-red-100` and their `dark:` twins) |
| tile-face / tile-edge / tile-ink *(new)* | `#fbf3df` / `#c9b27e` / `#1b2a30` | `#f3e7c9` / `#a8925d` / `#1b2a30` | tiles stay cream in dark mode |
| tile-used / tile-used-ink *(new)* | `#e7e1d4` / `#5b6a6f` | `#24393f` / `#9bb0b3` | |
| tile-highlight *(new)* | `#f2a516` | `#f5b83d` | hint-reveal ring |
| celebrate-1/2/3 *(new)* | `#0b6b6b` `#f2a516` `#e0564a` | `#4cc7bd` `#f5b83d` `#f07a6e` | confetti |

Register every new token in `tailwind.config.js` the same way as the existing ones
(`'game-tile-face': 'rgb(var(--game-tile-face) / <alpha-value>)'` and so on).

### 2.2 Contrast (WCAG 2.x, produced by `palette.mjs --markdown`)

| Use | Pair | AA min | Light | Dark |
|---|---|---|---|---|
| body text on page | `primary` on `paper` | 4.5:1 | #1b2a30 / #f4efe4 **12.89** | #e4eeec / #0d1b1f **14.86** |
| body text on card | `primary` on `surface` | 4.5:1 | #1b2a30 / #fffdf8 **14.54** | #e4eeec / #142a30 **12.64** |
| secondary text on card | `muted` on `surface` | 4.5:1 | #5b6a6f / #fffdf8 **5.53** | #9bb0b3 / #142a30 **6.59** |
| secondary text on page | `muted` on `paper` | 4.5:1 | #5b6a6f / #f4efe4 **4.90** | #9bb0b3 / #0d1b1f **7.75** |
| link / brand text on card | `secondary` on `surface` | 4.5:1 | #0b6b6b / #fffdf8 **6.20** | #4cc7bd / #142a30 **7.28** |
| primary button label | `on-secondary` on `secondary` | 4.5:1 | #ffffff / #0b6b6b **6.31** | #0d1b1f / #4cc7bd **8.55** |
| accent chip label | `on-accent` on `accent-fill` | 4.5:1 | #1b2a30 / #f2a516 **7.16** | #0d1b1f / #f5b83d **9.89** |
| accent large text / icon on card | `accent` on `surface` | 3:1 | #b86e00 / #fffdf8 **3.92** | #f5b83d / #142a30 **8.41** |
| success large text / icon | `success` on `surface` | 3:1 | #1d7a45 / #fffdf8 **5.27** | #4ade80 / #142a30 **8.59** |
| submit button label (bold, large) | `on-secondary` on `success` | 3:1 | #ffffff / #1d7a45 **5.35** | #0d1b1f / #4ade80 **10.10** |
| error text on card | `error` on `surface` | 4.5:1 | #c0392b / #fffdf8 **5.35** | #f87171 / #142a30 **5.41** |
| warning text on card | `warning` on `surface` | 4.5:1 | #9a5b00 / #fffdf8 **5.34** | #fbbf24 / #142a30 **8.96** |
| found-word chip | `primary` on `success-soft` | 4.5:1 | #1b2a30 / #e3f3e8 **12.85** | #e4eeec / #163a2a **10.61** |
| teammate chip / badge | `primary` on `secondary-soft` | 4.5:1 | #1b2a30 / #ddefee **12.43** | #e4eeec / #123a3a **10.48** |
| hint / achievement note | `primary` on `warning-soft` | 4.5:1 | #1b2a30 / #fdf1d8 **13.20** | #e4eeec / #3a2c10 **11.46** |
| error note | `primary` on `error-soft` | 4.5:1 | #1b2a30 / #fbe7e4 **12.43** | #e4eeec / #3d1d1d **12.74** |
| letter on tile | `tile-ink` on `tile-face` | 4.5:1 | #1b2a30 / #fbf3df **13.37** | #1b2a30 / #f3e7c9 **12.03** |
| letter on used tile (disabled, large) | `tile-used-ink` on `tile-used` | 3:1 | #5b6a6f / #e7e1d4 **4.31** | #9bb0b3 / #24393f **5.34** |
| tile bevel against card (decorative) | `tile-edge` on `surface` | 1.8:1 | #c9b27e / #fffdf8 **2.03** | #a8925d / #142a30 **4.94** |

Do **not** use `accent` (`#b86e00`) for small body text in light mode, because it only reaches 3.92:1.

### 2.3 One hex for the browser chrome

- **Light:** `theme-color` meta = `#0b6b6b`; manifest `theme_color` = `#0b6b6b`, `background_color` = `#f4efe4`.
- **Dark:** add `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0d1b1f">`.

The same values go into the icons and the og image.

## 3. Framing in the browser

### 3.1 Elevation (Tailwind `boxShadow` extension)

The tokens replace `border-4 … shadow-2xl` on the game card, and `shadow-lg` / `shadow-md` elsewhere.

| Token | Value | Use |
|---|---|---|
| `elev-1` | `0 1px 2px rgb(27 42 48 / .08)` | chips, inputs, side cards |
| `elev-2` | `0 1px 2px rgb(27 42 48 / .06), 0 8px 24px rgb(27 42 48 / .08)` | game card |
| `elev-3` | `0 4px 8px rgb(27 42 48 / .08), 0 24px 56px rgb(27 42 48 / .18)` | dialogs, drawers, end-of-round overlay |

In dark mode, swap the shadow colour for `rgb(0 0 0 / .3–.35)`.

### 3.2 Desktop, ≥ 1024 px (canvas boards "C · Desktop")

- **Page ground:** `paper` with a faint scattered-tile backdrop: 64 px rounded squares at `rgb(201 178 126 / .16)` with letters at `rgb(11 107 107 / .10)`, randomly rotated ±18°, kept to the margins, `aria-hidden`. Use a static SVG under `public/` set as `background-image`, not DOM nodes. In dark mode use `rgb(76 199 189 / .06)`.
- **Header (outside the card):** 80 px tall, 48 px side padding. Logo on the left; on the right, "Játékszabály" and "Beállítások" as 44 px outline buttons with icons. The page is no longer vertically centred: it is top-aligned with a 16 px gap under the header.
- **Game card:** 600 px wide, radius 24, `surface`, `elev-2`, padding 28/36/32, no border.
- **Side rail (≥ 1024 only, 320 px, 32 px gap):** a daily-puzzle card (streak, play button) and a leaderboard card (top 4 plus "Te", highlighted). Below 1024 px these stay inside Settings, as today. This is new UI that reuses the existing `DailyPanel` / `HighScoresPanel` data, so keep it behind the existing `uiConfig` toggles if those apply.

### 3.3 Mobile, < 640 px

- **Layout:** edge to edge. No card border, radius or shadow; the card is the page (`surface` ground).
- **Header:** 64 px, `paper` ground, bottom hairline. Mark at 38 px plus the wordmark at 26 px; help and settings become 44×44 icon-only buttons, which need `aria-label`.
- **Safe areas:** `padding: env(safe-area-inset-*)` on the header and the bottom of the page, plus `viewport-fit=cover` in the viewport meta.
- **Tiles:** 72 px in a 4-column grid (8 letters → 2 rows); 64 px for 9–10 letters.
- **Actions:** a 3-column grid (Új játék · Kever · OK), each 52 px tall with icon and label.

### 3.4 Installed PWA / TWA

- The splash comes from the manifest colours above plus `pwa-512x512`.
- The status bar is `#0b6b6b` in light mode and `#0d1b1f` in dark mode.

## 4. Tiles, chips and buttons (canvas board "D/E/F")

### 4.1 Letter tile

56 px desktop / 72 px mobile, radius 12 (14 on mobile), Baloo 2 800 at about 0.54 × the tile size.

| State | Spec |
|---|---|
| idle | `tile-face`; `box-shadow: inset 0 -4px 0 tile-edge, 0 2px 4px rgb(27 42 48/.12)`; letter `tile-ink` |
| hover / focus-visible | `translateY(-3px)`, shadow `0 6px 12px …/.16`, plus a 3 px `surface` gap and a 3 px `secondary` ring. **No scale**: the hit target must stay put (Playwright stability, see the `breathe` comment) |
| pressed | `translateY(3px)`, bevel collapses to `inset 0 -1px 0`, 80 ms ease-out |
| used | `tile-used`, letter `tile-used-ink`, no bevel or shadow, `disabled` |
| hint reveal (`currentAnimatingIndex`) | idle look plus `0 0 0 4px tile-highlight, 0 0 18px 4px rgb(242 165 22/.45)`; two slow pulses of the glow only (static glow under reduced motion) |
| pre-game placeholder | 2 px dashed `tile-edge` border, face at 50 % opacity, `aria-hidden` |

### 4.2 Found-word chips

Pill shape, 15 px 800 weight, padding `6 8 6 14`, with the points in an inner pill (`surface` ground).

| Chip | Spec |
|---|---|
| normal | `success-soft` ground, `primary` text, points in `success` |
| just found (`justFoundWord`) | `accent-fill` ground plus a 3 px `warning-soft` ring for 1.2 s, then settles to normal |
| full-length word | `secondary` ground with `on-secondary` text and a saffron Lucide `Sparkles` icon; stays that way |
| teammate | `secondary-soft` ground, with the finder's name in `muted` |

The 📖 and ⚑ actions inside chips become Lucide icons (§6), each with a hit area of at least 24×24 px.

### 4.3 Buttons

All buttons are pills.

| Button | Spec |
|---|---|
| Primary (Új játék, rematch) | `secondary` fill, `on-secondary` text, 52 px |
| Secondary (Kever) | 2 px `border` outline, `primary` text |
| Submit (OK) | `success` fill, `on-secondary` text; disabled state is `tile-used` ground with `muted` text |

Text links (Feladom, Segítség) get an icon, a 44 px min-height hit area and `muted` / `secondary` colour.

## 5. Celebrations (canvas board "E")

Implement each tier as a distinct confetti config plus a CSS class. Triggers live in `useGame.js` (guess
response) and `App.jsx` (end-of-game effects). Confetti colours come from the `celebrate-*` tokens, shape `square`.
**`prefers-reduced-motion`: no confetti, no transforms. Use the static fallback column.**

| # | Moment | Trigger (existing data) | Visual + motion | Sound | Reduced motion |
|---|---|---|---|---|---|
| 1 | valid word | scoring guess, not full length | chip pops: scale .6 → 1.06 → 1, 320 ms `cubic-bezier(.34,1.56,.64,1)`; 24 particles from the input, 600 ms | `correct` | chip appears, no scale |
| 2 | full-length / target word | `response.is_full_length` | board glow 0 → 1 → 0 over 900 ms; 90 particles, spread 100°; chip becomes the full-length style | rising 3-note (new `play('target')`) | static saffron outline on the board, 1.5 s |
| 3 | all words found | `allPossibleWordsFound` | overlay card "Tábla kész!" (`elev-3`, MobileEnd board): time bonus, "Segítség nélkül" badge if no hint, longest word; two side cannons × 3 bursts over 1.4 s; tiles drop with a 40 ms stagger, 500 ms ease-in | `fullClear` | card appears immediately |
| 4 | daily solved | daily game ends `completed` (`isDailyGame`) | summary card with the streak flame (scale 0 → 1, 450 ms spring) and a 7-day bar; share button (MobileDaily board) | softer arpeggio | static card |
| 5 | room win / cleared together | `RoomResults` with `reveal` | podium 2-1-3 (rank-1 block `secondary`, crown icon in `accent-fill`), rising with a 120 ms stagger over 400 ms; one cannon for the winner; co-op shows a shared trophy band | fanfare (winner only) | static podium |
| 6 | new personal best | `scoreAtExpiry > serverScores.your_best` captured **before** the post-game refetch | "Új rekord!" badge stamped onto the summary: rotate −8° → 0, scale 1.4 → 1, 260 ms | short chime | badge, no stamp |
| + | score count-up | `displayScore` changes | `tabular-nums`, 400 ms ease-out per change, 900 ms for the end-of-round total (`requestAnimationFrame` hook) | — | value set at once |
| + | end-of-round summary | `isTimeUp` (expired / given up) | card above the word list (DesktopDark board): score, words x/y, longest word, rank, "A teljes szó" target, Új játék + Megosztás; slides up 16 px with a 300 ms fade | — | fade only |

Sounds are synthesised in `components/sound.js`; new cues follow the same pattern. Keep the `aria-live` behaviour of the score and status regions.

## 6. Icons — Lucide

Use `lucide-react`, pinned to a release at least two weeks old (for example `^1.59.0`). Set stroke width 2,
size 18–20 in buttons, `aria-hidden`, and keep the visible text label or an `aria-label` on the button.

| Emoji → | Lucide | Where |
|---|---|---|
| ❓ | `CircleHelp` | help button |
| ⚙️ | `SlidersHorizontal` | settings button |
| 🚪 | `LogOut` | leave room |
| 🎲 | `Dices` | new game |
| 🔀 | `Shuffle` | scramble |
| ✅ | `Check` | submit; resolved |
| ✖️ ✕ | `X` | clear guess; close drawers / prompts |
| 🏆 | `Trophy` | score, leaderboard, achievements, rank 1 |
| ⏳ | `Hourglass` | timer; daily "not completed" |
| 🗓️ | `CalendarDays` | daily badge / panel |
| 🔥 | `Flame` | streak |
| 📤 | `Share2` | share |
| 🌱 | `Sprout` | easy-mode badge |
| ⚔️ / 👥 | `Swords` / `Users` | room mode |
| 👑 | `Crown` | host |
| 📖 | `BookOpen` | dictionary lookup |
| ⚑ | `Flag` | report word / name |
| 💡 | `Lightbulb` | hint |
| 🏳️ | `Flag` (outline) | give up |
| 🔊 / 🔇 | `Volume2` / `VolumeX` | sound toggle |
| ☀️ / 🌙 / 🖥 | `Sun` / `Moon` / `Monitor` | theme toggle |
| 📊 | `ChartColumn` | stats |
| 🔒 | `Lock` | locked achievement |
| ✨ | `Sparkles` | all found; personal best |
| 🔽 / 🔼 | `ChevronDown` / `ChevronUp` | missing-words toggle |
| 📲 / 📡 | `Download` / `WifiOff` | install prompt / offline notice |

- **Strings that embed an emoji used as a button icon:** strip the emoji from the string (both `hu.json` and `en.json`) and render the icon in JSX. These are `giveUpHint.giveUp`, `giveUpHint.hint`, `hintMessage`, `highScores.show`, `stats.show`, `achievements.title`, `remainingWords.show/hide`, `install.prompt` and `offline`.
- **Help text in `help.*` and the daily share text:** these describe the controls with emoji (e.g. "🔀 újrakeveri"). Reword them to name the controls ("A Kever gomb …"), or leave them if you prefer; the share text is plain text, so its emoji stay.
- **Admin panels:** out of scope.
- **E2E names:** the tests look buttons up by name (`/Feladom \(megoldás/`, `/Segítség/`, `'Új játék'`, `'Betűk keverése'`, `'Tipp beküldése'`, `'Beállítások'`, `'Játékszabály'`). Removing the emoji keeps those matches; do not change the words.

## 7. Share and store

- **og:image:** 1200×630 PNG at `public/og-image.png`, rendered from canvas board G:
  - teal ground with faint scattered tiles;
  - on-brand mark (120) with the white wordmark (112 px);
  - tagline "Rakj ki minél több szót a megkevert betűkből." and a row of cream tiles spelling KELESZTŐ;
  - a saffron pill "Napi rejtvény · Ranglista · Szoba" and `betuveto.tmsso.com`.

  Then set `og:image` to that file with 1200/630 dimensions, and `twitter:card` = `summary_large_image`.
- **Daily share image (optional, tier 4):** the teal summary card from the MobileDaily board, rendered to a 1080×1350 PNG on the client with canvas and shared through the Web Share API Level 2 (`navigator.canShare({ files })`). Fall back to today's text share.
- **Play feature graphic:** 1024×500 using the same composition as the og image. **Screenshots:** regenerate them with the #126 pipeline after implementation.

## 8. Clean-up (from the handoff, still valid)

- `frontend/src/App.css` is **not imported anywhere**: delete it. It holds the legacy `.game-*` colours and the `#3498db` focus ring.
- Route the raw `blue-*` / `green-*` / `red-*` / `yellow-*` / `amber-*` / `purple-*` / `gray-*` / `slate-*` classes in game UI through the tokens above. The tile, chip, badge, note and button styles in §4 cover nearly all of them. The room badge uses `secondary-soft`; the easy-mode badge uses `success-soft`.
- Delete the unused `celebrate` keyframe or use it for tier 2.

## 9. Done when

- [ ] `node docs/design/palette.mjs` passes, and the CSS tokens match its `--css` output.
- [ ] `npm --prefix frontend run lint`, `npm --prefix frontend run build` and `npm test` all pass.
- [ ] E2E (`frontend/e2e`) passes, including the axe checks from #125 in **both** themes.
- [ ] With reduced motion on, there is no confetti and no moving element.
- [ ] Both themes look right at 390 / 768 / 1440 px.
- [ ] The `<h1>` accessible name is "Betűvető", and the ű/ő accents render saffron at 26 px and 96 px.
- [ ] Favicons, PWA icons and the maskable icon are regenerated; `theme-color` and the manifest are updated; the og image is live.
- [ ] Play screenshots are regenerated (#126 pipeline).

Open points for the owner, left at the defaults stated above:

- **Desktop side rail:** it's new UI; dropping it is fine.
- **Dark mode mark:** uses the light colouring (teal V tile).
- **Daily share image:** optional.
