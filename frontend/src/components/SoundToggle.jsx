import { useTranslation } from 'react-i18next'

/**
 * ROADMAP Batch 10 item 8 — a 🔊 / 🔇 toggle for the synthesised sound effects, sitting
 * beside the theme/language pickers in the header. Presentational: <App> owns the state
 * (useSound) and passes it down, since App's own `play()` reads the same value.
 */
export default function SoundToggle({ enabled, onToggle }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onToggle(!enabled)}
      aria-pressed={enabled}
      aria-label={enabled ? t('soundToggle.disable') : t('soundToggle.enable')}
      title={enabled ? t('soundToggle.disable') : t('soundToggle.enable')}
      className="text-sm leading-none rounded-lg border border-game-border bg-game-surface px-2 py-1 text-game-primary focus:outline-none focus:ring-2 focus:ring-game-secondary"
    >
      {enabled ? '🔊' : '🔇'}
    </button>
  )
}
