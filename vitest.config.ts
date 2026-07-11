import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Separate from vite.config.ts (which pulls in the React/Tailwind plugins the app needs, but
// engine/ unit tests don't) — just the @ alias engine modules import through.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
