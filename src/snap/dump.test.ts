import { it } from 'vitest';
import { fixtureReader } from './__fixtures__/reader';
import { resolvePart } from './resolvePart';

const r3 = (v: readonly number[]) => v.map((n) => Math.round(n * 1000) / 1000);

it('dump', async () => {
  for (const id of ['3001', '4070', '3700', '3818', '3070b']) {
    const pts = await resolvePart(id, fixtureReader);
    console.log(`\n=== ${id} — ${pts.length} points`);
    for (const p of pts) {
      const secs = p.sections.map((s) => `${s.variant} ${s.radius} ${s.length}`).join(' · ');
      console.log(
        `  ${p.kind} ${p.gender} pos=${JSON.stringify(r3(p.position))} axis=${JSON.stringify(
          r3([p.orientation[3], p.orientation[4], p.orientation[5]]),
        )} secs=[${secs}] slide=${p.slide} key=${p.key} id=${p.id}`,
      );
    }
  }
});
