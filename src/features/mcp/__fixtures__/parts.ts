/**
 * A `PartSource` over the captured corpus in `src/snap/__fixtures__/`.
 *
 * Real LDraw geometry and real shadow-library annotations, resolved the same way the
 * application resolves them — connections from the shadow reader, bounds and occupancy
 * from the triangles. Session tests assert against actual brick behaviour, so a
 * stacked pair mates eight studs because it physically does, not because a fixture
 * says so.
 */

import { boundsFromTriangles, partTriangles } from '../../../ldraw/bounds.ts';
import { buildOccupancy } from '../../../snap/collision.ts';
import { fixtureReader } from '../../../snap/__fixtures__/reader.ts';
import { resolvePart } from '../../../snap/resolvePart.ts';
import type { PartDef } from '../../../snap/types.ts';
import type { PartSource } from '../session.ts';

/** Titles the corpus does not carry, so handles read the way they would in the app. */
const TITLES: Readonly<Record<string, string>> = {
  '3001': 'Brick  2 x  4',
  '3070b': 'Tile  1 x  1 with Groove',
  '3700': 'Technic Brick  1 x  2 with Hole',
  '3818': 'Minifig Arm Right',
  '3937': 'Hinge Brick  1 x  2 Base',
  '2335': 'Flag  2 x  2 Square',
  '4070': 'Brick  1 x  1 with Headlight',
};

const cache = new Map<string, Promise<PartDef>>();

export const fixtureParts: PartSource = (id) => {
  let pending = cache.get(id);
  if (!pending) {
    pending = (async () => {
      const [connections, triangles] = await Promise.all([
        resolvePart(id, fixtureReader),
        partTriangles(id, fixtureReader),
      ]);
      const bounds = boundsFromTriangles(triangles);
      return {
        id,
        title: TITLES[id] ?? id,
        connections,
        bounds,
        occupancy: buildOccupancy(triangles, bounds, connections),
      };
    })();
    cache.set(id, pending);
  }
  return pending;
};

/** Part ids present in the captured corpus. */
export const FIXTURE_PARTS = ['2335', '3001', '3070b', '3700', '3818', '3937', '4070'] as const;
