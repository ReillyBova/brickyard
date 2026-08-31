#!/usr/bin/env node
/**
 * Runs one TypeScript file through Vite's SSR module loader instead of plain Node.
 *
 * `tools/*.ts` scripts normally run directly under Node's native type stripping (see
 * `docs/PREBAKE.md`), which works as long as every file they import uses explicit
 * `.ts` extensions on relative imports — the rest of `src/` does not: `src/math.ts`
 * and `src/types.ts` (both frozen contract files) are imported as `'../math'` and
 * `'../types'` throughout the app, which is what `moduleResolution: "bundler"`
 * expects and what every other module already relies on. A script that needs to
 * import real logic from `src/` — as `tools/build-model-manifests.ts` does, to keep
 * one MPD parser rather than a second copy — needs that same resolution.
 *
 * This borrows Vite's own dev-server module graph (already a project dependency) to
 * get it, rather than adding a new one. No bundling, no dist output — `ssrLoadModule`
 * transforms and executes the target file (and its imports) the same way `vite dev`
 * does for any other module.
 *
 * Usage: node tools/run-with-vite.mjs <path/to/script.ts>
 */

import { createServer } from 'vite';

const target = process.argv[2];
if (!target) {
  console.error('usage: node tools/run-with-vite.mjs <path/to/script.ts>');
  process.exit(1);
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  await server.ssrLoadModule(`/${target}`);
} finally {
  await server.close();
}
