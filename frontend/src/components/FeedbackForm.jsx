import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { betuAPI } from '../api/client'

const MAX_LENGTH = 2000 // mirrors lib/feedback.ts MAX_FEEDBACK_LENGTH

/**
 * ROADMAP 12.7 — in-app tester feedback, inside the help dialog. Replaces 12.5's mailto
 * link: a mailto has to publish the receiving address in the served bundle, and the
 * owner chose not to publish one. The message goes to POST /api/v1/feedback and shows
 * up on the admin dashboard.
 *
 * Collapsed to one button until opened, so the help dialog stays about the rules.
 * ROADMAP 13.4: also in the settings panel's footer (`compact`), where the collapsed state
 * is a single "send feedback" link instead of the help dialog's intro sentence.
 */
export default function FeedbackForm({ compact = false }) {
  const { t, i18n } = useTranslation()
  // useId, not a fixed id: the help dialog and the settings panel each render one.
  const messageId = useId()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  // 'idle' | 'sending' | 'sent' | 'rate_limited' | 'error'
  const [status, setStatus] = useState('idle')

  const trimmed = message.trim()

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!trimmed || status === 'sending') return
    setStatus('sending')
    try {
      await betuAPI.sendFeedback(trimmed, window.location.href, i18n.resolvedLanguage)
      setMessage('')
      setStatus('sent')
    } catch (error) {
      setStatus(error?.status === 429 ? 'rate_limited' : 'error')
    }
  }

  if (!open) {
    const openButton = (
      <button
        type="button"
        onClick={() => { setOpen(true); setStatus('idle') }}
        className={compact
          ? 'text-xs text-game-muted underline hover:text-game-secondary focus:outline-none focus:ring-2 focus:ring-game-secondary rounded'
          : 'underline text-game-secondary hover:text-blue-700 dark:hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-game-secondary rounded'}
      >
        {compact ? t('feedback.openFromSettings') : t('feedback.open')}
      </button>
    )
    if (compact) return openButton
    return (
      <p className="text-sm">
        {t('help.feedbackIntro')}{' '}
        {openButton}
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 text-sm w-full">
      <label htmlFor={messageId} className="font-semibold">
        {t('feedback.label')}
      </label>
      <textarea
        id={messageId}
        value={message}
        onChange={(event) => { setMessage(event.target.value); if (status !== 'sending') setStatus('idle') }}
        maxLength={MAX_LENGTH}
        rows={4}
        placeholder={t('feedback.placeholder')}
        className="w-full rounded-lg border-2 border-game-border bg-game-paper p-2 text-game-primary focus:outline-none focus:ring-2 focus:ring-game-secondary"
      />
      <p className="text-xs text-game-muted">{t('feedback.privacyNote')}</p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!trimmed || status === 'sending'}
          className="rounded-lg bg-game-secondary text-white font-bold px-3 py-1.5 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-game-secondary disabled:opacity-50"
        >
          {status === 'sending' ? t('feedback.sending') : t('feedback.send')}
        </button>
        <span role="status" aria-live="polite" className="text-xs">
          {status === 'sent' && <span className="text-game-success font-semibold">{t('feedback.sent')}</span>}
          {status === 'rate_limited' && <span className="text-game-muted">{t('feedback.rateLimited')}</span>}
          {status === 'error' && <span className="text-game-error">{t('feedback.error')}</span>}
        </span>
      </div>
    </form>
  )
}
