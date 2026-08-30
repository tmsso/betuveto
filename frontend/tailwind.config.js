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
      },
      keyframes: {
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
