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
})
