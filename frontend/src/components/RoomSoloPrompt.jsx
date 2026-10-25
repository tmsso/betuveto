import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * ROADMAP 15.4 — shown to the last player still in a room round once everyone else has left
 * or given up: carry on alone, or finish. The clock does not stop while this is open; the
 * server already added `bonusSeconds` to make up for the interruption (D-15d), which is why
 * the copy says so. "Finish" is the ordinary give-up, "Continue" just records the answer so
 * the prompt does not come back (including after a reload).
 *
 * Dialog semantics follow <ConfirmationModal>: focus moves to the safe default (continue),
 * and there is deliberately no backdrop-click or Escape dismissal — the question needs an
 * answer, and an accidental dismissal would just bring it back on the next poll.
 */
export default function RoomSoloPrompt({ bonusSeconds, busy, onContinue, onFinish }) {
  const { t } = useTranslation()
  const continueRef = useRef(null)

  useEffect(() => {
    continueRef.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-solo-title"
        data-testid="room-solo-prompt"
        className="relative w-full max-w-sm bg-game-surface text-game-primary rounded-xl shadow-2xl border-4 border-game-border p-6 text-center"
      >
        <h2 id="room-solo-title" className="text-xl font-bold font-display mb-2">{t('room.solo.title')}</h2>
        <p className="text-sm mb-1">{t('room.solo.message')}</p>
        <p className="text-sm font-semibold text-game-secondary mb-4">{t('room.solo.bonus', { seconds: bonusSeconds })}</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            ref={continueRef}
            type="button"
            disabled={busy}
            onClick={onContinue}
            className="px-4 py-2 rounded-lg bg-game-secondary text-white font-semibold hover:bg-blue-600 disabled:opacity-50"
          >
            {t('room.solo.continue')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onFinish}
            className="px-4 py-2 rounded-lg border-2 border-game-border font-semibold hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {t('room.solo.finish')}
          </button>
        </div>
      </div>
    </div>
  )
}
