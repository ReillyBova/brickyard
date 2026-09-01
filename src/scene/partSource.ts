/**
 * Part geometry loading.
 *
 * `LDrawLoader` caches per part internally and returns clones sharing `BufferGeometry`,
 * but it hands back a `Group` of scene objects (meshes plus edge lines), materialised
 * against whatever colour code we ask for. We only want the raw geometry — position and
 * normal, no per-instance colour baked in — so it can be reused across an `InstancedMesh`
 * for every colour that part appears in via LDraw's colour-16 passthrough.
 *
 * Fetching is behind `PartGeometrySource` on purpose: today it hits the raw upstream
 * mirror directly because the baked catalog pipeline isn't wired up. Swapping in the
 * baked catalog later means implementing this interface once, not touching callers.
 */

import * as THREE from 'three';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { Bounds } from '../types';
import { boundsFromPositions } from '../ldraw/bounds';
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

  constructor(baseUrl: string = DEFAULT_PARTS_BASE_URL) {
    this.baseUrl = baseUrl;
    this.loader = new LDrawLoader();
    this.loader.setPartsLibraryPath(baseUrl);
    this.loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    this.loader.smoothNormals = true;
  }

  /** Distinct parts loaded vs. failed after retry, for `SceneRenderer` to surface. */
  stats(): PartSourceStats {
    return { loaded: this.loaded, failed: this.failed };
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
      () => this.failed++,
    );
    this.cache.set(partId, promise);
    return promise;
  }

  private async loadUncached(partId: string): Promise<LoadedPart> {
    await this.ensureMaterials();
    const group = await this.loader.loadAsync(`${this.baseUrl}parts/${partId}.dat`);
    const geometry = mergeMeshGeometry(group);
    return { partId, geometry, bounds: boundsOf(geometry) };
  }
}
