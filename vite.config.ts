import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so the deploy workflow sets
  // GITHUB_PAGES=true to build with that base. Local dev and the Tauri build stay at root.
  base: process.env.GITHUB_PAGES ? '/voxpaint/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
  // Bind to all interfaces (not just localhost) so the dev server is reachable from other devices
  // on the LAN, e.g. a phone at http://geoff.local:5173 — needed to test touch input for real.
  server: {
    host: true,
    allowedHosts: ['geoff.local']
  },
})
