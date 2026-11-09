import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { googleSignInAvailable, signOutGoogle, startGoogleSignIn, takeSignInOutcome } from '../googleAccount'

/**
 * ROADMAP 8.1 — "Keep my progress with Google", inside Settings. Optional: the game never
 * asks for it. Reads its own linked state from /me/preferences when the drawer opens.
 */
export default function AccountLink({ isOpen }) {
  const { t } = useTranslation()
  const [linked, setLinked] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(() => takeSignInOutcome())

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    fetch('/api/v1/me/preferences')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (!cancelled) setLinked(Boolean(body?.google_linked)) })
      .catch(() => { if (!cancelled) setLinked(false) })
    return () => { cancelled = true }
  }, [isOpen])

  if (!googleSignInAvailable() || linked === null) return null

  const run = async (action) => {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } catch {
      setMessage('failed')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1" data-testid="account-link">
      {linked ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-game-muted font-semibold">{t('account.linked')}</span>
          <button type="button" disabled={busy} onClick={() => run(signOutGoogle)}
            className="text-sm underline text-game-secondary disabled:opacity-50">
            {t('account.signOut')}
          </button>
        </div>
      ) : (
        <>
          <button type="button" disabled={busy} onClick={() => run(startGoogleSignIn)}
            className="h-10 px-4 rounded-full border-2 border-game-border bg-game-surface font-semibold text-game-primary hover:bg-game-paper disabled:opacity-50">
            {t('account.keepProgress')}
          </button>
          <p className="text-xs text-game-muted">{t('account.explain')}</p>
        </>
      )}
      {message && (
        <p role="status" className={`text-xs ${message === 'failed' ? 'text-game-error' : 'text-game-success'}`}>
          {t(`account.outcome.${message}`, { defaultValue: t('account.outcome.linked') })}
        </p>
      )}
    </div>
  )
}
