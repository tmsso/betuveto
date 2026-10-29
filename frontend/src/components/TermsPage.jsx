import { useTranslation } from 'react-i18next'

/**
 * Static terms-of-use page (ROADMAP 16.1), served at /terms by the pathname check in
 * main.jsx, like /privacy. Deliberately names no person: the public repo must not carry the
 * operator's identity, so the text speaks of "the project" / "the operator" and points to
 * the in-app feedback form as the contact channel (no published email, decided 2026-10-02).
 */
const SECTIONS = ['service', 'fairPlay', 'names', 'content', 'words', 'liability', 'changes', 'contact']

export default function TermsPage() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-game-paper text-game-primary px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="text-sm text-game-secondary hover:underline">
          {t('terms.back')}
        </a>

        <h1 className="mt-4 text-2xl font-bold">{t('terms.title')}</h1>
        <p className="mt-1 text-xs text-game-muted">{t('terms.updated')}</p>

        <p className="mt-6 text-sm leading-relaxed">{t('terms.intro')}</p>

        <div className="mt-6 space-y-5">
          {SECTIONS.map((key) => (
            <section key={key}>
              <h2 className="text-base font-semibold">{t(`terms.sections.${key}.heading`)}</h2>
              <p className="mt-1 text-sm leading-relaxed text-game-muted">
                {t(`terms.sections.${key}.body`)}
              </p>
            </section>
          ))}
        </div>

        <a href="/privacy" className="mt-8 inline-block text-sm text-game-secondary hover:underline">
          {t('privacy.title')}
        </a>
      </div>
    </div>
  )
}
