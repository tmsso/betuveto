import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
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

// No router library (ROADMAP 5.1): the app has exactly one static top-level split —
// "/" vs "/admin" — with no nested or dynamic routes, so a pathname check here is
// simpler than adding react-router for what would be a single always-matching rule.
// Any tabs within the admin panel are component-local state, not sub-routes.
const isAdminRoute = window.location.pathname.startsWith('/admin')

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
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
