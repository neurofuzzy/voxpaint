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
})
