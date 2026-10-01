// ROADMAP Batch 10 item 9 (moved out of main.jsx in 12.3 so the error boundary can report
// too). Inert until VITE_SENTRY_DSN is set: the condition is a build-time constant, so
// with no DSN Vite drops the branch and never ships the Sentry chunk to players.
// @sentry/browser, not @sentry/react — the only React integration this app needs is the
// one ErrorBoundary below, which reports through captureError() instead. Dynamic import
// so, even when enabled, the SDK loads off the critical path.
const sentryReady = import.meta.env.VITE_SENTRY_DSN
  ? import('@sentry/browser')
      .then((Sentry) => {
        Sentry.init({
          dsn: import.meta.env.VITE_SENTRY_DSN,
          environment: import.meta.env.MODE,
          tracesSampleRate: 0,
        })
        return Sentry
      })
      .catch(() => null) // observability must never break the app
  : Promise.resolve(null)

/** Report an error React caught (the global handlers Sentry installs never see those). */
export function captureError(error, extra) {
  sentryReady
    .then((Sentry) => Sentry?.captureException(error, extra ? { extra } : undefined))
    .catch(() => {})
}
