import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import FeedbackForm from './FeedbackForm'

/**
 * How to play (ROADMAP 12.5) — the rules in one short dialog, for testers arriving from
 * a shared link with no other explanation. Opened from the header, never automatically:
 * an auto-opening overlay on first visit would sit in front of the start button for
 * every fresh browser, including the E2E suite's.
 *
 * Numbers that an admin can change (minimum word length, hint cost) come in as props
 * from the active game's rules, so the text never contradicts the game.
 * Dialog semantics + focus handling mirror <SettingsPanel>.
 */
export default function HelpPanel({ isOpen, onClose, minWordLength, hintCost }) {
  const { t } = useTranslation()
  const closeButtonRef = useRef(null)
  const previouslyFocusedRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!isOpen) return
    previouslyFocusedRef.current = document.activeElement
    closeButtonRef.current?.focus()
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocusedRef.current?.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  const items = [
    t('help.goal'),
    t('help.words', { count: minWordLength }),
    t('help.scoring'),
    t('help.buttons', { cost: hintCost }),
    t('help.curation'),
    t('help.more'),
  ]

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-panel-title"
        className="relative max-h-full w-full max-w-md overflow-y-auto bg-game-surface text-game-primary rounded-xl shadow-2xl border-4 border-game-border p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="help-panel-title" className="text-2xl font-bold font-display">{t('help.title')}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('help.close')}
            className="text-2xl leading-none px-2 text-game-muted hover:text-game-primary focus:outline-none focus:ring-2 focus:ring-game-secondary rounded"
          >
            ×
          </button>
        </div>
        <ul className="space-y-3 text-sm leading-relaxed list-none">
          {items.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
        <div className="mt-5 pt-4 border-t border-game-border">
          <FeedbackForm />
        </div>
      </div>
    </div>
  )
}
