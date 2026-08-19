import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // Serve the (precached) app shell for any failed/offline navigation,
        // but never for API calls — the game has no offline mode, so the
        // shell itself must communicate "you're offline", not pretend to work.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // The admin panel's own chunk (ROADMAP 5.2 follow-up: it now pulls in
        // @neondatabase/auth, ~350kB) has no offline mode either — an admin needs a live
        // DB connection regardless — so precaching it would only cost every *player*
        // background bandwidth for a page they'll essentially never visit.
        globIgnores: ['**/AdminApp-*.js'],
      },
      manifest: {
        name: 'Betűvető',
        short_name: 'Betűvető',
        description: 'Magyar szójáték — rakj ki minél több szót a betűkből!',
        lang: 'hu',
        theme_color: '#3498db',
        background_color: '#f8f9fa',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  server: {
    host: true,
    allowedHosts: true,
  },
  // ROADMAP Batch 10 item 5 (E2E smoke test): `vite preview` serves this build's own
  // static output (no dev-time HTML transform, so the local vite-dev byte-offset bug —
  // see the repo's own dev-server notes — can't apply here), proxied against the real
  // production API rather than a local one, since this repo has no local API server since
  // Batch 1.3's cutover to same-origin Vercel functions. Only affects `vite preview`;
  // Vercel's own deploy never runs it.
  preview: {
    proxy: {
      '/api': {
        target: 'https://betuveto.vercel.app',
        changeOrigin: true,
      },
    },
  },
})
