// Captures the real LDraw part files `build-chest-catalog.ts` falls back to when no local
// mirror is synced, so the chest still shows real names offline. Same approach as
// `capture-fixtures.mjs`: fetch once from the upstream GitHub mirror, commit the result,
// never touch the network again after that.
//
//   node tools/capture-chest-fixtures.mjs
//
// Output lands at src/ui/PartsChest/__fixtures__/mirror/library/parts/, laid out exactly
// like `.cache/ldraw/library/parts/` so `createLibraryReader` reads either one identically.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LDRAW = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/parts/';

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/ui/PartsChest/__fixtures__/mirror/library/parts',
);

// Kept in sync with CURATED_CHEST in build-chest-catalog.ts.
const PART_IDS = [
  '3001', '3002', '3003', '3004', '3005', '3010', '2456',
  '3020', '3022', '3023', '3024', '3031',
  '3068b', '3069b', '3070b', '4162',
  '3037', '3040b', '3665a',
  '4070',
  '3700', '3701', '3673', '32523', '3705', '4716',
  '3937', '3938',
  '4085c', '30374',
  '973', '3626b', '3818', '3820',
  '6141', '3062b',
];

let ok = 0;
const missing = [];

for (const id of PART_IDS) {
  const res = await fetch(`${LDRAW}${id}.dat`);
  if (!res.ok) {
    missing.push(id);
    console.log(`${id}: ${res.status}`);
    continue;
  }
  const text = await res.text();
  const path = join(OUT, `${id}.dat`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
  ok++;
  console.log(`${id}: ok`);
}

console.log(`\n${ok}/${PART_IDS.length} captured -> ${OUT}`);
if (missing.length) console.log(`missing: ${missing.join(', ')}`);
