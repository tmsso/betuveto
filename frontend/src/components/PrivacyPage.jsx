import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { betuAPI } from '../api/client'

/**
 * Static privacy page (ROADMAP — "Privacy page + data deletion endpoint"). Served at
 * /privacy via the pathname check in main.jsx, the same no-router pattern as /admin.
 * Self-contained: it only needs the i18n context (already initialised globally) and the
 * one `deleteMe` API call. Theme-aware via the `game-*` CSS custom properties and the
 * pre-paint `.dark` toggle in index.html, so no useTheme wiring.
 */
export default function PrivacyPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState('idle') // 'idle' | 'deleting' | 'done' | 'error'

  const handleDelete = async () => {
    if (!window.confirm(t('privacy.delete.confirm'))) return
    setStatus('deleting')
    try {
      await betuAPI.deleteMe()
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  const sections = ['stored', 'notStored', 'hosting', 'retention']

  return (
    <div className="min-h-screen bg-game-paper text-game-primary px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="text-sm text-game-secondary hover:underline">
          {t('privacy.back')}
        </a>

        <h1 className="mt-4 text-2xl font-bold">{t('privacy.title')}</h1>
        <p className="mt-1 text-xs text-game-muted">{t('privacy.updated')}</p>

        <p className="mt-6 text-sm leading-relaxed">{t('privacy.intro')}</p>

        <div className="mt-6 space-y-5">
          {sections.map((key) => (
            <section key={key}>
              <h2 className="text-base font-semibold">{t(`privacy.sections.${key}.heading`)}</h2>
              <p className="mt-1 text-sm leading-relaxed text-game-muted">
                {t(`privacy.sections.${key}.body`)}
              </p>
            </section>
          ))}
        </div>

        <section className="mt-8 rounded-lg border border-game-border bg-game-surface p-4">
          <h2 className="text-base font-semibold">{t('privacy.delete.heading')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-game-muted">{t('privacy.delete.body')}</p>

          {status === 'done' ? (
            <div className="mt-3">
              <p role="status" className="text-sm font-semibold text-game-success">
                {t('privacy.delete.done')}
              </p>
              <a
                href="/"
                className="mt-2 inline-block text-sm text-game-secondary hover:underline"
              >
                {t('privacy.delete.startFresh')}
              </a>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleDelete}
                disabled={status === 'deleting'}
                className="mt-3 rounded-md border border-game-error px-3 py-1.5 text-sm font-semibold text-game-error hover:bg-game-error/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'deleting' ? t('privacy.delete.deleting') : t('privacy.delete.button')}
              </button>
              {status === 'error' && (
                <p role="alert" className="mt-2 text-sm text-game-error">
                  {t('privacy.delete.error')}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
