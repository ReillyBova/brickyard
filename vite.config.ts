import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Deployed under /brickyard/ on GitHub Pages; served from root in development.
const base = process.env.GITHUB_PAGES === 'true' ? '/brickyard/' : '/'

// PORT lets several worktrees run dev servers side by side.
const port = Number(process.env.PORT) || 5173

export default defineConfig({
  base,
  plugins: [react()],
  // Agent worktrees live under .claude/worktrees/, inside the repo. Without this, every
  // dev server watches every sibling worktree and force-reloads on their edits.
  server: {
    port,
    strictPort: true,
    watch: { ignored: ['**/.claude/worktrees/**'] },
  },
  preview: { port: port + 1000, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Performance budgets live in `*.perf.test.ts` and run under
    // `vitest.perf.config.ts` (`npm run test:perf`): they measure wall clock, which is
    // the machine's business as much as the code's, so they stay out of the gate CI and
    // every worktree runs on every change.
    exclude: ['src/**/*.perf.test.ts'],
  },
})
