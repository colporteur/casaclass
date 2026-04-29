import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// IMPORTANT: when deploying to GitHub Pages at https://<user>.github.io/<repo>/
// set base to '/<repo>/'. Override with VITE_BASE if you use a custom domain.
const base = process.env.VITE_BASE ?? '/casa-class/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Casa Class',
        short_name: 'Casa Class',
        description: 'Wednesday-morning discussion group — speakers, transcripts, and topics.',
        theme_color: '#F59E0B',
        background_color: '#FFFBF0',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: `${base}index.html`
      }
    })
  ]
})
