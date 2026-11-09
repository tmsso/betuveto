/** @type {import('tailwindcss').Config} */
export default {
  // ROADMAP Batch 10 item 7: class-based dark mode — a `.dark` on <html> (set by
  // useTheme, and pre-paint by the inline script in index.html) toggles the theme, so a
  // per-player DB preference can override the OS `prefers-color-scheme`, the same
  // three-way (preference -> system -> default) model `preferred_language` already uses.
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic palette, backed by CSS custom properties (defined in index.css) so a
        // single `:root` / `.dark` block re-themes every `*-game-*` utility at once
        // instead of a `dark:` variant on every element. `<alpha-value>` keeps Tailwind's
        // opacity modifiers (e.g. `text-game-primary/70`) working.
        'game-primary': 'rgb(var(--game-primary) / <alpha-value>)',
        'game-secondary': 'rgb(var(--game-secondary) / <alpha-value>)',
        'game-success': 'rgb(var(--game-success) / <alpha-value>)',
        'game-warning': 'rgb(var(--game-warning) / <alpha-value>)',
        'game-error': 'rgb(var(--game-error) / <alpha-value>)',
        'game-paper': 'rgb(var(--game-paper) / <alpha-value>)',
        'game-border': 'rgb(var(--game-border) / <alpha-value>)',
        // New tokens introduced for dark mode: `surface` replaces bare `bg-white` cards,
        // `muted` replaces the recurring `text-gray-500` secondary text.
        'game-surface': 'rgb(var(--game-surface) / <alpha-value>)',
        'game-muted': 'rgb(var(--game-muted) / <alpha-value>)',
        // Design handback 2026-11-07 (docs/design-handback.md §2): label-on-fill, saffron
        // accent, soft chip/note grounds, the letter-tile set and confetti colours.
        'game-on-secondary': 'rgb(var(--game-on-secondary) / <alpha-value>)',
        'game-accent': 'rgb(var(--game-accent) / <alpha-value>)',
        'game-accent-fill': 'rgb(var(--game-accent-fill) / <alpha-value>)',
        'game-on-accent': 'rgb(var(--game-on-accent) / <alpha-value>)',
        'game-success-soft': 'rgb(var(--game-success-soft) / <alpha-value>)',
        'game-secondary-soft': 'rgb(var(--game-secondary-soft) / <alpha-value>)',
        'game-warning-soft': 'rgb(var(--game-warning-soft) / <alpha-value>)',
        'game-error-soft': 'rgb(var(--game-error-soft) / <alpha-value>)',
        'game-tile-face': 'rgb(var(--game-tile-face) / <alpha-value>)',
        'game-tile-edge': 'rgb(var(--game-tile-edge) / <alpha-value>)',
        'game-tile-ink': 'rgb(var(--game-tile-ink) / <alpha-value>)',
        'game-tile-used': 'rgb(var(--game-tile-used) / <alpha-value>)',
        'game-tile-used-ink': 'rgb(var(--game-tile-used-ink) / <alpha-value>)',
        'game-tile-highlight': 'rgb(var(--game-tile-highlight) / <alpha-value>)',
        'game-celebrate-1': 'rgb(var(--game-celebrate-1) / <alpha-value>)',
        'game-celebrate-2': 'rgb(var(--game-celebrate-2) / <alpha-value>)',
        'game-celebrate-3': 'rgb(var(--game-celebrate-3) / <alpha-value>)',
        // Fills under white text (ROADMAP 16.3): see index.css for why these are separate.
        'game-button': 'rgb(var(--game-button) / <alpha-value>)',
        'game-button-hover': 'rgb(var(--game-button-hover) / <alpha-value>)',
        'game-go': 'rgb(var(--game-go) / <alpha-value>)',
        'game-go-hover': 'rgb(var(--game-go-hover) / <alpha-value>)',
      },
      // Elevation scale (handback §3.1) replaces ad-hoc shadow-md/lg/2xl. The shadow colour
      // is a variable so dark mode can swap the teal-ink tint for plain black.
      boxShadow: {
        'elev-1': '0 1px 2px rgb(var(--shadow-ink) / .08)',
        'elev-2': '0 1px 2px rgb(var(--shadow-ink) / .06), 0 8px 24px rgb(var(--shadow-ink) / .08)',
        'elev-3': '0 4px 8px rgb(var(--shadow-ink) / .08), 0 24px 56px rgb(var(--shadow-ink) / .18)',
      },
      fontFamily: {
        // Rounded, readable base face with full Hungarian (ő/ű) support.
        'sans': ['Nunito', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Curved display face for the title/headings (not handwritten/calligraphic).
        'display': ['"Baloo 2"', 'Nunito', 'system-ui', 'sans-serif'],
      },
      animation: {
        'shake': 'shake 0.5s',
        'bounce-in': 'bounceIn 0.6s',
        'letter-fly': 'letterFly 0.3s ease-out',
        'celebrate': 'celebrate 1s ease-in-out',
        // ROADMAP Batch 10 item 17 — a gentle pulse on the pre-game "start" button, so an
        // empty board reads as "waiting for you" rather than broken. Auto-neutralised by
        // the prefers-reduced-motion block in index.css like every other animation here.
        'breathe': 'breathe 2.6s ease-in-out infinite',
        // Design refresh celebrations (handback §5). All neutralised by the
        // prefers-reduced-motion rule in index.css, leaving the static end state.
        'summary-in': 'summaryIn 300ms ease-out both',
        'stamp': 'stamp 260ms cubic-bezier(.34,1.56,.64,1) both',
        'flame': 'flame 450ms cubic-bezier(.34,1.56,.64,1) both',
        'board-glow': 'boardGlow 900ms ease-in-out both',
      },
      keyframes: {
        summaryIn: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        stamp: {
          '0%': { opacity: '0', transform: 'rotate(-8deg) scale(1.4)' },
          '100%': { opacity: '1', transform: 'rotate(0) scale(1)' },
        },
        flame: {
          '0%': { transform: 'scale(0)' },
          '100%': { transform: 'scale(1)' },
        },
        // Tier 2: a saffron glow that swells and fades around the board. The end state
        // (100%) keeps a faint static outline only while the class is on (1.5 s).
        boardGlow: {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--game-accent-fill) / 0)' },
          '40%': { boxShadow: '0 0 0 6px rgb(var(--game-accent-fill) / .9), 0 0 40px 12px rgb(var(--game-accent-fill) / .45)' },
          '100%': { boxShadow: '0 0 0 3px rgb(var(--game-accent-fill) / .8)' },
        },
        // A pulsing glow ring only — deliberately no `transform: scale`, so the button's
        // hit target never moves (a scaling interactive element wobbles under the cursor
        // and fails Playwright's "element is stable" actionability check).
        breathe: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(var(--game-secondary) / 0.5)' },
          '50%': { boxShadow: '0 0 0 14px rgb(var(--game-secondary) / 0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-5px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(5px)' },
        },
        bounceIn: {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '50%': { transform: 'scale(1.05)' },
          '70%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        letterFly: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        celebrate: {
          '0%, 100%': { transform: 'scale(1) rotate(0deg)' },
          '25%': { transform: 'scale(1.1) rotate(-5deg)' },
          '75%': { transform: 'scale(1.1) rotate(5deg)' },
        },
      },
    },
  },
  plugins: [],
}
