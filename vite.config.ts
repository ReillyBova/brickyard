import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Deployed under /brickyard/ on GitHub Pages; served from root in development.
const base = process.env.GITHUB_PAGES === 'true' ? '/brickyard/' : '/'

// PORT lets several worktrees run dev servers side by side.
const port = Number(process.env.PORT) || 5173

export default defineConfig({
  base,
  plugins: [react()],
  server: { port, strictPort: true },
  preview: { port: port + 1000, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
