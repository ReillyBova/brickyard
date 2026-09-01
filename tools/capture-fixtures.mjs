// Capture the LDraw and LDCad shadow files that the snap parser fixtures need.
//
// Run once; the output is committed. Tests read from disk and never touch the network.
//
//   node tools/capture-fixtures.mjs            # capture the standard fixture set
//   node tools/capture-fixtures.mjs 3001 4070  # capture specific parts
//
// Only the files actually reachable from the listed parts are fetched. Bulk mirroring of
// the upstream archives is a different job — see docs/PREBAKE.md.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LDRAW = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';
const SHADOW = 'https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/snap/__fixtures__');

/**
 * The fixture set. Each part is here because it breaks a naive parser:
 *   3001  grid expansion and primitive inheritance
 *   4070  a sideways stud; a square section
 *   3700  a stepped profile, and one primitive emitting both genders
 *   3818  a non-axis-aligned, fractional connection
 *   3070b a part with no shadow coverage anywhere in its tree
 *   3947  a 32x32 baseplate: 39,304 triangles over a 160x15x160 grid, which is what the
 *         collision performance budgets are measured against
 */
const DEFAULT_PARTS = ['3001', '4070', '3700', '3818', '3070b', '3947'];

const MAX_DEPTH = 16;

const remote = new Map();

async function get(url) {
  if (remote.has(url)) return remote.get(url);
  const res = await fetch(url);
  const text = res.ok ? await res.text() : null;
  remote.set(url, text);
  return text;
}

async function save(rel, text) {
  const path = join(OUT, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

const normalise = (ref) => ref.replace(/\\/g, '/').toLowerCase().trim();

function candidates(ref) {
  const n = normalise(ref);
  if (/^(parts|p|models)\//.test(n)) return [n];
  return [`parts/${n}`, `p/${n}`, `models/${n}`];
}

const stats = { ldraw: 0, shadow: 0, unresolved: new Set() };
const seenLdraw = new Set();
const seenShadow = new Set();

/** Capture the shadow file at `rel`, following any SNAP_INCL references it makes. */
async function captureShadow(rel, depth) {
  if (seenShadow.has(rel) || depth > MAX_DEPTH) return;
  seenShadow.add(rel);
  const text = await get(SHADOW + rel);
  if (text === null) return;
  await save(`shadow/${rel}`, text);
  stats.shadow++;

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^0\s+!LDCAD\s+SNAP_INCL\s+(.*)$/i);
    if (!m) continue;
    const ref = m[1].match(/\[\s*ref\s*=([^\]]*)\]/i)?.[1];
    if (!ref) continue;
    for (const cand of candidates(ref)) await captureShadow(cand, depth + 1);
  }
}

/** Walk the LDraw reference tree from `rel`, capturing every file and its shadow twin. */
async function captureLdraw(rel, depth) {
  if (seenLdraw.has(rel) || depth > MAX_DEPTH) return;
  seenLdraw.add(rel);
  const text = await get(LDRAW + rel);
  if (text === null) return;
  await save(`ldraw/${rel}`, text);
  stats.ldraw++;

  await captureShadow(rel, 0);

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('1 ')) continue;
    const tok = line.split(/\s+/);
    if (tok.length < 15) continue;
    const child = tok.slice(14).join(' ');
    let found = false;
    for (const cand of candidates(child)) {
      if (seenLdraw.has(cand) || (await get(LDRAW + cand)) !== null) {
        await captureLdraw(cand, depth + 1);
        found = true;
        break;
      }
    }
    if (!found) stats.unresolved.add(child);
  }
}

const parts = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PARTS;

for (const id of parts) {
  const before = { ...stats, ldraw: stats.ldraw, shadow: stats.shadow };
  await captureLdraw(`parts/${id}.dat`, 0);
  console.log(
    `${id}: +${stats.ldraw - before.ldraw} ldraw, +${stats.shadow - before.shadow} shadow`,
  );
}

console.log(`\n${stats.ldraw} ldraw files, ${stats.shadow} shadow files -> ${OUT}`);
if (stats.unresolved.size) {
  console.log(`unresolved refs: ${[...stats.unresolved].join(', ')}`);
}
