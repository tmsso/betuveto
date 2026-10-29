import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { betuAPI } from '../api/client'

/**
 * ROADMAP 16.2 — a small flag next to another player's display name (leaderboards, room
 * lobby). Asks for confirmation, then posts the name to /report-name, which files it in
 * the admin feedback queue. Renders nothing for anonymous entries (no name to report).
 * State is per button and not remembered: a repeat report is harmless, and the shared
 * daily feedback cap (server side) is what stops flooding.
 */
export default function ReportNameButton({ name, place }) {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState('idle') // 'idle' | 'sending' | 'sent' | 'error'

  if (!name) return null

  if (status === 'sent') {
    return (
      <span role="status" className="text-xs text-game-muted" title={t('reportName.sent')}>
        ✓<span className="sr-only">{t('reportName.sent')}</span>
      </span>
    )
  }

  const report = async () => {
    if (!window.confirm(t('reportName.confirm', { name }))) return
    setStatus('sending')
    try {
      await betuAPI.reportName(name, place, window.location.href, i18n.language)
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  return (
    <button
      type="button"
      onClick={report}
      disabled={status === 'sending'}
      aria-label={t('reportName.button', { name })}
      title={status === 'error' ? t('reportName.error') : t('reportName.button', { name })}
      className={`shrink-0 text-xs leading-none opacity-60 hover:opacity-100 focus:opacity-100 disabled:opacity-30 ${status === 'error' ? 'text-game-error' : 'text-game-muted'}`}
    >
      ⚑
    </button>
  )
}
