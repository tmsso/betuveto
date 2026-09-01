import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PrivacyPage from './components/PrivacyPage.jsx'
// i18next init (ROADMAP 6.2) — must run before App renders so useTranslation() has a
// ready instance on first render. AdminApp doesn't use it; importing unconditionally here
// is still simplest and matches how the font imports below are also unconditional.
import './i18n/index.js'
// Self-hosted web fonts (offline-friendly for the PWA). Only the latin + latin-ext
// subsets are imported: latin-ext carries the Hungarian double-acute letters ő/ű (which
// the previous system cursive fallback mangled), and skipping the other scripts keeps
// Devanagari/Cyrillic/Vietnamese font files out of the bundle. Nunito is the rounded base
// UI face; Baloo 2 is the display face.
import '@fontsource/nunito/latin-400.css'
import '@fontsource/nunito/latin-ext-400.css'
import '@fontsource/nunito/latin-600.css'
import '@fontsource/nunito/latin-ext-600.css'
import '@fontsource/nunito/latin-700.css'
import '@fontsource/nunito/latin-ext-700.css'
import '@fontsource/nunito/latin-800.css'
import '@fontsource/nunito/latin-ext-800.css'
import '@fontsource/baloo-2/latin-700.css'
import '@fontsource/baloo-2/latin-ext-700.css'
import '@fontsource/baloo-2/latin-800.css'
import '@fontsource/baloo-2/latin-ext-800.css'
import './index.css'

// No router library (ROADMAP 5.1): the app has a few static top-level paths — "/",
// "/admin", "/privacy" — with no nested or dynamic routes, so a pathname check here is
// simpler than adding react-router for what would be a handful of always-matching rules.
// Any tabs within the admin panel are component-local state, not sub-routes.
// ROADMAP Batch 10 item 9 — error tracking. Inert until VITE_SENTRY_DSN is set: the
// condition is build-time constant, so with no DSN Vite drops the branch and never ships
// the @sentry/react chunk to players (the same bundle-cost care as the AdminApp lazy load
// below). Dynamic import so, even when enabled, the SDK loads off the critical path.
if (import.meta.env.VITE_SENTRY_DSN) {
  import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0,
      })
    })
    .catch(() => { /* observability must never break the app */ })
}

const isAdminRoute = window.location.pathname.startsWith('/admin')
const isPrivacyRoute = window.location.pathname === '/privacy'

// ROADMAP Batch 10 item 7: dark mode is player-facing only for now. The admin panels
// (AdminApp + the 5 Admin*Panel files) still use light-only class strings, so force the
// admin route back to light here — before React paints — rather than ship a half-dark
// admin screen. Drop this once the admin panels get their own dark pass.
if (isAdminRoute) document.documentElement.classList.remove('dark')

// Lazy, not a static import (ROADMAP 5.2 follow-up): AdminApp now pulls in
// @neondatabase/auth, which alone roughly doubles the bundle (measured: ~320kB -> ~650kB
// minified) — a cost every *player* would otherwise pay on every visit for a feature only
// an admin ever uses. A dynamic import makes it its own chunk, fetched only on /admin.
const AdminApp = lazy(() => import('./AdminApp.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isAdminRoute ? (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    ) : isPrivacyRoute ? (
      <PrivacyPage />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
