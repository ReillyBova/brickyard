/**
 * Placement: turning pointer movement into a brick on the baseplate.
 *
 * This is the layer the whole project is judged on. Everything underneath it has a
 * checkable right answer — a part resolves to sixteen connection points or it doesn't,
 * an operation inverts or it doesn't. Here the question is only ever "did it land where
 * the person meant", and that has no fixture.
 *
 * Kept deliberately small and readable so the behaviour can be tuned by feel rather than
 * reasoned about from a diagram.
 */

import { IDENTITY } from '../../math';
import type { BrickId, Mat4, Vec3 } from '../../types';
import { boundsFromTriangles, partTriangles } from '../../ldraw/bounds';
import { loadBakedParts, type BakedParts } from '../bakedParts.ts';
import { buildOccupancy, collides } from '../../snap/collision';
import { resolvePart } from '../../snap/resolvePart';
import { groundPlacement, resolveSnap } from '../../snap/resolve';
import { HashSpatialIndex } from '../../snap/spatialIndex';
import type { PartDef, SnapCandidate } from '../../snap/types';

const LDRAW_BASE = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';
const SHADOW_BASE = 'https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/';

/**
 * Runtime connectivity, from the bake where possible and from source otherwise, cached
 * for the session either way.
 *
 * The baked sets (`docs/PREBAKE.md`) cover every part the shadow library annotates, so a
 * covered part costs a map lookup: no fetch, no tree walk, no voxelisation. A part
 * outside them — the long tail, or any part at all when `public/baked/` has not been
 * generated — falls back to cold-resolving from upstream, roughly twenty requests per
 * part, which is fine for a handful of part types and unacceptable for a model.
 *
 * `baked` is injectable so tests can supply their own sets, or none.
 */
export function createPartCatalog(
  baked: Promise<BakedParts> = loadBakedParts(),
): (partId: string) => Promise<PartDef> {
  const files = new Map<string, Promise<string | null>>();
  const parts = new Map<string, Promise<PartDef>>();

  const read = async (relativePath: string): Promise<string | null> => {
    const cached = files.get(relativePath);
    if (cached) return cached.catch(() => null);
    const base = relativePath.startsWith('shadow/') ? SHADOW_BASE : LDRAW_BASE;
    const rest = relativePath.replace(/^(shadow|ldraw)\//, '');
    const pending = fetch(base + rest)
      .then((r) => (r.ok ? r.text() : null))
      .catch((error: unknown) => {
        // A 404 is a real answer and worth caching — the resolver probes paths that
        // legitimately do not exist. A thrown request is not: caching it would break
        // the part for the rest of the session over one dropped connection.
        files.delete(relativePath);
        throw error;
      });
    files.set(relativePath, pending);
    return pending;
  };

  /**
   * Collision needs real bounds and a real occupancy mask: given a zero box and an empty
   * mask it finds no occupied voxels and reports no collision, ever — which looks exactly
   * like working collision detection until you try to overlap something. So a part is
   * only served from the bake when its mask is there; connections alone are not enough.
   */
  const fromSource = async (partId: string): Promise<PartDef> => {
    // Connections and geometry are resolved from the same files, so they are fetched
    // together.
    const [connections, triangles] = await Promise.all([
      resolvePart(partId, read),
      partTriangles(partId, read),
    ]);
    const bounds = boundsFromTriangles(triangles);
    return {
      id: partId,
      title: partId,
      connections,
      bounds,
      occupancy: buildOccupancy(triangles, bounds, connections),
    };
  };

  return (partId: string): Promise<PartDef> => {
    const cached = parts.get(partId);
    if (cached) return cached;
    const pending = baked.then((sets) => {
      const collision = sets.occupancy.get(partId);
      if (collision === undefined) return fromSource(partId);
      return {
        id: partId,
        title: partId,
        connections: sets.connections.get(partId) ?? [],
        bounds: collision.bounds,
        occupancy: collision.occupancy,
      };
    });
    parts.set(partId, pending);
    return pending;
  };
}

export interface PlacedBrick {
  id: BrickId;
  partId: string;
  colorCode: number;
  transform: Mat4;
  part: PartDef;
}

/**
 * The scene operations placement needs. Narrow on purpose: this is the only coupling
 * between the interaction layer and the renderer, so the renderer stays replaceable.
 */
export interface PlacementScene {
  pick(ndcX: number, ndcY: number): { brick: BrickId; point: Vec3; normal: Vec3 } | null;
  pickRay(ndcX: number, ndcY: number): { origin: Vec3; direction: Vec3 };
  showGhost(partId: string, colorCode: number, transform: Mat4, valid: boolean, wireframe?: boolean): Promise<void>;
  hideGhost(): void;
}

export interface PlacementState {
  /** Best-first. Empty means there is nowhere to put the piece under the cursor. */
  candidates: SnapCandidate[];
  /** Which candidate is showing; Tab advances it. */
  index: number;
  /** Quarter turns about the connection axis. */
  roll: number;
  transform: Mat4 | null;
  /**
   * Whether the shown placement can actually be made. Collision is a property of the
   * placement, not of the candidate list: one test per frame against the transform
   * being displayed. Testing several and quietly showing a non-colliding alternative
   * would move the piece away from where the cursor is pointing, which is the failure
   * this whole layer exists to avoid.
   */
  valid: boolean;
}

export class PlacementController {
  readonly index = new HashSpatialIndex();
  private readonly bricks = new Map<BrickId, PlacedBrick>();

  private state: PlacementState = {
    candidates: [],
    index: 0,
    roll: 0,
    transform: null,
    valid: false,
  };
  private held: PartDef | null = null;
  private heldColor = 4;
  private previous: Mat4 | undefined;
  /**
   * Set by `pickUp`, cleared by `hold`/`commit`. A picked-up piece renders as a
   * wireframe outline throughout — see `ghost.ts` — so it reads as "you're relocating
   * something that already exists" rather than "here is a new one", the way a fresh
   * chest choice does.
   */
  private wasPickedUp = false;

  private readonly scene: PlacementScene;

  constructor(scene: PlacementScene) {
    this.scene = scene;
  }

  /** Whether a piece is on the cursor — placement mode versus selection mode. */
  get holding(): boolean {
    return this.held !== null;
  }

  /** Whether the piece on the cursor came from the baseplate rather than the chest. */
  get pickedUp(): boolean {
    return this.wasPickedUp;
  }

  /** The piece on the cursor. Null puts the tool back into selection. */
  hold(part: PartDef | null, colorCode = this.heldColor): void {
    this.held = part;
    this.heldColor = colorCode;
    this.wasPickedUp = false;
    this.previous = undefined;
    this.state = { candidates: [], index: 0, roll: 0, transform: null, valid: false };
    if (part === null) this.scene.hideGhost();
  }

  /**
   * Take an already-placed piece back onto the cursor, rejoining the same placement
   * pipeline a fresh chest choice uses — the next placement re-solves candidates,
   * mating and collision exactly as it would for a new piece, structurally rather
   * than needing its own bespoke check (see `EditorSession.transformSelection`'s
   * `collides()` fix for the alternative this sidesteps).
   *
   * `previousTransform` seeds continuity with where the piece actually was, so the
   * first hover after picking it up favours landing back near its own former spot
   * over some other candidate the cursor happens to be closer to.
   */
  pickUp(part: PartDef, colorCode: number, previousTransform: Mat4): void {
    this.held = part;
    this.heldColor = colorCode;
    this.wasPickedUp = true;
    this.previous = previousTransform;
    this.state = { candidates: [], index: 0, roll: 0, transform: null, valid: false };
  }

  /**
   * Recolor the held piece without disturbing candidates, roll or continuity — a
   * palette click restyles the ghost in place, it doesn't restart placement.
   */
  recolor(colorCode: number): void {
    this.heldColor = colorCode;
    if (this.held !== null) void this.paint();
  }

  add(brick: PlacedBrick): void {
    this.bricks.set(brick.id, brick);
    this.index.insert(brick.id, brick.part, brick.transform);
  }

  remove(id: BrickId): void {
    this.bricks.delete(id);
    this.index.remove(id);
  }

  /**
   * Keep a placed brick's lookahead position current after it moves outside a
   * placement gesture — a keyboard nudge, or an undo/redo landing on a new transform.
   * Without this, candidate resolution and collision keep testing against where the
   * brick used to be.
   */
  updateTransform(id: BrickId, transform: Mat4): void {
    const existing = this.bricks.get(id);
    if (!existing) return;
    const updated: PlacedBrick = { ...existing, transform };
    this.bricks.set(id, updated);
    this.index.insert(id, existing.part, transform);
  }

  get placed(): readonly PlacedBrick[] {
    return [...this.bricks.values()];
  }

  private lookup = (id: BrickId): { part: PartDef; transform: Mat4 } | null => {
    const b = this.bricks.get(id);
    return b ? { part: b.part, transform: b.transform } : null;
  };

  /** Recompute from the pointer. Returns the transform the ghost should show. */
  move(ndcX: number, ndcY: number): Mat4 | null {
    const part = this.held;
    if (part === null) return null;

    const hit = this.scene.pick(ndcX, ndcY);
    const ray = this.scene.pickRay(ndcX, ndcY);
    const candidates = resolveSnap(
      {
        part,
        rayOrigin: ray.origin,
        rayDirection: ray.direction,
        ...(hit ? { hit } : {}),
        ...(this.previous ? { previous: this.previous } : {}),
        roll: this.state.roll,
      },
      this.index,
      this.lookup,
    );

    let transform: Mat4 | null = null;
    if (candidates.length > 0) {
      transform = candidates[0].transform;
    } else if (!hit) {
      // Over empty space: rest it on the baseplate rather than showing nothing.
      const ray = this.scene.pickRay(ndcX, ndcY);
      transform = groundPlacement(part, ray.origin, ray.direction);
    }

    this.state = {
      candidates,
      index: 0,
      roll: this.state.roll,
      transform,
      valid: transform === null ? false : !collides(part, transform, this.index),
    };
    this.previous = transform ?? undefined;
    void this.paint();
    return transform;
  }

  /** Cycle to the next candidate. Cuts, never tweens — see docs/DESIGN.md. */
  cycle(): void {
    if (this.state.candidates.length < 2) return;
    const index = (this.state.index + 1) % this.state.candidates.length;
    const transform = this.state.candidates[index].transform;
    this.state = {
      ...this.state,
      index,
      transform,
      valid: this.held === null ? false : !collides(this.held, transform, this.index),
    };
    this.previous = this.state.transform ?? undefined;
    void this.paint();
  }

  /**
   * Quarter turn about the connection axis.
   *
   * Takes the last pointer position so the placement can be re-solved immediately.
   * Changing `roll` alone leaves the ghost showing the old orientation until the
   * pointer happens to move, which reads as the key not working.
   */
  rotate(ndc?: readonly [number, number]): void {
    this.state = { ...this.state, roll: (this.state.roll + 1) % 4 };
    if (ndc) this.move(ndc[0], ndc[1]);
  }

  private async paint(): Promise<void> {
    const { transform } = this.state;
    if (this.held === null || transform === null) {
      this.scene.hideGhost();
      return;
    }
    await this.scene.showGhost(this.held.id, this.heldColor, transform, this.state.valid, this.wasPickedUp);
  }

  /**
   * Commit the shown placement. Returns the new brick, or null when there is nothing to
   * place — the caller decides whether that is worth saying out loud.
   */
  commit(id: BrickId): PlacedBrick | null {
    const { transform, valid } = this.state;
    if (this.held === null || transform === null || !valid) return null;

    const brick: PlacedBrick = {
      id,
      partId: this.held.id,
      colorCode: this.heldColor,
      transform,
      part: this.held,
    };
    this.add(brick);

    // Clear the committed placement. Without this every pointerup re-places the same
    // transform, so a stationary double-click stacks bricks inside each other — and
    // `previous` would anchor continuity to a position the ghost has already left.
    this.state = {
      candidates: [],
      index: 0,
      roll: this.state.roll,
      transform: null,
      valid: false,
    };
    this.previous = undefined;
    this.wasPickedUp = false;
    this.scene.hideGhost();
    return brick;
  }

  get current(): PlacementState {
    return this.state;
  }
}

export const translation = (x: number, y: number, z: number): Mat4 => [
  ...IDENTITY.slice(0, 12),
  x,
  y,
  z,
  1,
];
