import { useTranslation } from 'react-i18next'

const OPTIONS = ['system', 'light', 'dark']

/**
 * ROADMAP Batch 10 item 7 — three-way theme picker (System / Light / Dark). Presentational:
 * <App> owns the state via useTheme() and passes it down, so the hook's one-time
 * server-preference adoption fires on app load rather than only when <SettingsPanel>
 * (where this now lives, ROADMAP Batch 10 item 15) is first opened. A plain <select>
 * keeps it keyboard-accessible and screen-reader-labelled with no custom widget code.
 */
export default function ThemeToggle({ theme, setTheme }) {
  const { t } = useTranslation()

  return (
    <select
      value={theme}
      onChange={(e) => setTheme(e.target.value)}
      aria-label={t('themeSelector.ariaLabel')}
      className="mt-1 text-xs border border-game-border rounded-lg px-2 py-0.5 text-game-primary bg-game-surface focus:outline-none focus:ring-2 focus:ring-game-secondary"
    >
      {OPTIONS.map((opt) => (
        <option key={opt} value={opt}>{t(`themeSelector.${opt}`)}</option>
      ))}
    </select>
  )
}
