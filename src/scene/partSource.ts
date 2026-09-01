/**
 * Part geometry loading.
 *
 * `LDrawLoader` caches per part internally and returns clones sharing `BufferGeometry`,
 * but it hands back a `Group` of scene objects (meshes plus edge lines), materialised
 * against whatever colour code we ask for. We only want the raw geometry — position and
 * normal, no per-instance colour baked in — so it can be reused across an `InstancedMesh`
 * for every colour that part appears in via LDraw's colour-16 passthrough.
 *
 * Fetching is behind `PartGeometrySource` on purpose: `BakedPartSource` answers chest
 * parts from the bundled bake with no request at all, and falls through to
 * `LDrawPartSource` — the upstream mirror, fetched live — for everything else. Callers
 * hold only the interface, so which tier actually served a part is invisible to them.
 */

import * as THREE from 'three';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { Bounds } from '../types';
import { boundsFromPositions } from '../ldraw/bounds';
import type { PartGeometry } from '../ldraw/types';
import { loadBakedParts, type BakedParts } from './bakedParts.ts';
import { ConcurrencyPool } from './concurrencyPool.ts';
import { withRetry } from './retry.ts';

/** Default source: the upstream LDraw parts library mirror, fetched over HTTPS. */
export const DEFAULT_PARTS_BASE_URL =
  'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';

export interface LoadedPart {
  partId: string;
  /** Position + normal only, in LDU, part-local. No colour attributes. */
  geometry: THREE.BufferGeometry;
  bounds: Bounds;
}

export interface PartGeometrySource {
  load(partId: string): Promise<LoadedPart>;
}

/**
 * LDraw's reference search order (`docs/LDRAW-PRIMER.md`): `parts/`, then `p/`, then
 * `models/`. A model can reference a primitive directly rather than through a proper
 * part — botanical and technic sets do this for greebling (leaves, axle holes, box
 * fillers: `1-8cylo`, `box3u10p`, `axl3hol8`) — and a primitive lives under `p/`, not
 * `parts/`. Trying only `parts/<id>.dat` 404s on every such reference. Measured against
 * the bundled Colosseum model, this single fix accounts for the model's entire 57%
 * geometry-load failure rate (11,725 of 20,725 bricks): every one of the 45 unique ids
 * that miss under `parts/` resolves cleanly under `p/`, and none are missing under both.
 */
const PART_SEARCH_PREFIXES = ['parts/', 'p/', 'models/'] as const;

/**
 * How many distinct parts may be resolving over the network at once. Each part load
 * fans out into its own subfile tree (`docs/ARCHITECTURE.md`: "~20 network fetches" per
 * part cold), so this is not "how many HTTP requests" — it's closer to
 * `PART_LOAD_CONCURRENCY * 20` requests in flight at the busiest moment. 8 is chosen to
 * sit comfortably inside a browser's own per-origin HTTP/2 stream allowance while still
 * giving the upstream mirror (a third party we don't control the rate limits of) room to
 * keep up — high enough that Saturn V's 141 unique parts resolve in a handful of waves
 * rather than one unbounded burst, low enough that it isn't indistinguishable from no cap
 * at all.
 */
const PART_LOAD_CONCURRENCY = 8;

/** One retry beyond the first attempt, mainly for transient failures under load — see
 *  `retry.ts`'s module doc for why this doesn't fix a genuinely-missing upstream file. */
const PART_LOAD_ATTEMPTS = 2;
const PART_LOAD_RETRY_DELAY_MS = 250;

export interface PartSourceStats {
  /** Distinct parts resolved successfully. */
  loaded: number;
  /** Distinct parts that failed after every retry — see `SceneRenderer`'s handling. */
  failed: number;
  /** Ids of the parts counted in `failed`, for surfacing which pieces are missing. */
  failedPartIds: readonly string[];
}

/**
 * Real bounds, computed from the merged position attribute via the same pure AABB math
 * `src/ldraw/bounds.ts` uses for fixture-tested parts — one implementation for both the
 * runtime (loaded through three.js) and offline (parsed) paths. Only a truly empty
 * geometry (no position attribute at all) falls back to a zero box.
 */
function boundsOf(geometry: THREE.BufferGeometry): Bounds {
  const position = geometry.getAttribute('position');
  if (position === undefined) return { min: [0, 0, 0], max: [0, 0, 0] };
  return boundsFromPositions(position.array);
}

/**
 * Strips colour and pulls every `Mesh` under `group` into one merged geometry.
 *
 * `LDrawLoader` bakes most transforms directly into vertex positions as it flattens
 * subfiles, but parts loaded as a separate nested group (kept apart so per-subfile
 * materials can differ) carry their placement as `position`/`quaternion`/`scale`
 * instead — which only lands in `matrixWorld` after `updateMatrixWorld` runs. Nothing
 * renders `group` before we read it here, so without this call `matrixWorld` is still
 * the untouched identity and any such subobject's geometry is merged at the origin
 * instead of its real offset, corrupting both the merged mesh and its bounds.
 */
function mergeMeshGeometry(group: THREE.Object3D): THREE.BufferGeometry {
  group.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = child.geometry as THREE.BufferGeometry;
    // Only position + normal survive the merge — colour is supplied per instance by
    // the material, not baked into the geometry.
    const stripped = new THREE.BufferGeometry();
    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal');
    if (position === undefined || normal === undefined) return;
    stripped.setAttribute('position', position);
    stripped.setAttribute('normal', normal);
    if (source.index !== null) stripped.setIndex(source.index);
    stripped.applyMatrix4(child.matrixWorld);
    geometries.push(stripped);
  });

  if (geometries.length === 0) return new THREE.BufferGeometry();
  const merged = mergeGeometries(geometries, false);
  return merged ?? geometries[0];
}

/**
 * Loads parts one at a time from an LDraw library mirror (default: the upstream raw
 * GitHub mirror). In-memory only — nothing is cached to disk — and requests are
 * deduplicated so concurrent loads of the same part share one fetch.
 */
export class LDrawPartSource implements PartGeometrySource {
  private readonly baseUrl: string;
  private readonly loader: LDrawLoader;
  private readonly cache = new Map<string, Promise<LoadedPart>>();
  private materialsReady: Promise<void> | null = null;
  private readonly pool = new ConcurrencyPool(PART_LOAD_CONCURRENCY);
  private loaded = 0;
  private failed = 0;
  private readonly failedPartIds = new Set<string>();

  constructor(baseUrl: string = DEFAULT_PARTS_BASE_URL) {
    this.baseUrl = baseUrl;
    this.loader = new LDrawLoader();
    this.loader.setPartsLibraryPath(baseUrl);
    this.loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    this.loader.smoothNormals = true;
  }

  /** Distinct parts loaded vs. failed after retry, for `SceneRenderer` to surface. */
  stats(): PartSourceStats {
    return { loaded: this.loaded, failed: this.failed, failedPartIds: [...this.failedPartIds] };
  }

  private ensureMaterials(): Promise<void> {
    if (this.materialsReady === null) {
      this.materialsReady = this.loader.preloadMaterials(`${this.baseUrl}LDConfig.ldr`);
    }
    return this.materialsReady;
  }

  load(partId: string): Promise<LoadedPart> {
    const cached = this.cache.get(partId);
    if (cached !== undefined) return cached;

    // Queued through the pool *before* the promise is cached, so every concurrent
    // request for the same never-seen partId still shares this one queued attempt
    // (the cache.set below happens synchronously, ahead of any await).
    const promise = this.pool.run(() => withRetry(() => this.loadUncached(partId), PART_LOAD_ATTEMPTS, PART_LOAD_RETRY_DELAY_MS));
    promise.then(
      () => this.loaded++,
      () => {
        this.failed++;
        this.failedPartIds.add(partId);
      },
    );
    this.cache.set(partId, promise);
    return promise;
  }

  /**
   * Tries every search prefix in turn, first success wins. `LDrawLoader.loadAsync`
   * rejects on a non-OK fetch, so a miss on `parts/` just falls through to `p/` — see
   * `PART_SEARCH_PREFIXES` above for why this matters.
   */
  private async loadUncached(partId: string): Promise<LoadedPart> {
    await this.ensureMaterials();
    let lastError: unknown;
    for (const prefix of PART_SEARCH_PREFIXES) {
      try {
        const group = await this.loader.loadAsync(`${this.baseUrl}${prefix}${partId}.dat`);
        const geometry = mergeMeshGeometry(group);
        return { partId, geometry, bounds: boundsOf(geometry) };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

/**
 * Rehydrates one baked `PartGeometry` — plain typed arrays, transferable across a worker
 * boundary — into the `THREE.BufferGeometry` `LoadedPart` carries. No copy of the
 * underlying buffers: the attributes view the same `Float32Array`/`Uint32Array` the bake
 * reader produced.
 */
function toLoadedPart(part: PartGeometry): LoadedPart {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
  return { partId: part.partId, geometry, bounds: part.bounds };
}

/**
 * Prefers bundled chest geometry over `fallback`. The chest (`DEFAULT_CHEST` in
 * `tools/prebake.ts`, see docs/PREBAKE.md) is a couple dozen popular parts baked into
 * `geometry.bin` and shipped to every visitor; a chest part resolves from an
 * already-downloaded typed array with no network request and no subfile tree walk. Any
 * part outside the chest — the overwhelming majority of the library — falls straight
 * through to `fallback` unchanged, exactly as if this wrapper weren't there.
 *
 * `loadBakedParts` itself never rejects and never blocks on a missing or unreadable
 * bake — see its own doc — so this adds no new failure mode over `fallback` alone.
 */
export class BakedPartSource implements PartGeometrySource {
  private readonly fallback: PartGeometrySource;
  private readonly baked: Promise<BakedParts>;

  constructor(fallback: PartGeometrySource, baked: Promise<BakedParts> = loadBakedParts()) {
    this.fallback = fallback;
    this.baked = baked;
  }

  async load(partId: string): Promise<LoadedPart> {
    const { geometry } = await this.baked;
    const baked = geometry.get(partId);
    return baked !== undefined ? toLoadedPart(baked) : this.fallback.load(partId);
  }
}
