// ROADMAP 12.5 — tester feedback by pre-filled email. The address is a build-time env var
// (VITE_FEEDBACK_EMAIL, set on Vercel), not a literal here: this repository is public, and
// keeping an owner's personal address out of its history is the project's privacy rule.
// It does end up in the served bundle when set — unavoidable for a mailto link, and fine
// for an address the owner chose to publish to testers. Unset → no link is rendered.
const FEEDBACK_EMAIL = import.meta.env.VITE_FEEDBACK_EMAIL

/** A mailto: link with subject + a short context line pre-filled, or null when unset. */
export function feedbackHref(t) {
  if (!FEEDBACK_EMAIL) return null
  const subject = t('feedback.subject')
  const body = `${t('feedback.bodyIntro')}\n\n\n---\n${window.location.href}\n${navigator.userAgent}`
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
