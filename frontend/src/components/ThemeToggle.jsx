import { useTranslation } from 'react-i18next'
import { useTheme } from './useTheme'

const OPTIONS = ['system', 'light', 'dark']

/**
 * ROADMAP Batch 10 item 7 — three-way theme picker (System / Light / Dark), styled to
 * match the UI-language selector it sits beside in the header. A plain <select> keeps it
 * keyboard-accessible and screen-reader-labelled with no custom widget code.
 */
export default function ThemeToggle() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

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
