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
import { collides } from '../../snap/collision';
import { resolvePart } from '../../snap/resolvePart';
import { groundPlacement, resolveSnap } from '../../snap/resolve';
import { HashSpatialIndex } from '../../snap/spatialIndex';
import type { PartDef, SnapCandidate } from '../../snap/types';

const LDRAW_BASE = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';
const SHADOW_BASE = 'https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/';

/**
 * Runtime connectivity, fetched per part and cached for the session.
 *
 * Cold-resolving a part is roughly twenty requests, which is exactly why the baked
 * catalog exists in `docs/PREBAKE.md`. Until that pipeline is wired up this fetches
 * directly, which is fine for a handful of part types and unacceptable for a model.
 */
export function createPartCatalog(): (partId: string) => Promise<PartDef> {
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

  return (partId: string): Promise<PartDef> => {
    const cached = parts.get(partId);
    if (cached) return cached;
    const pending = resolvePart(partId, read).then((connections) => ({
      id: partId,
      title: partId,
      connections,
      // Bounds and occupancy come from geometry, which the bake will supply. Nothing on
      // the placement path reads them yet, and a wrong value would be worse than an
      // obviously-absent one.
      bounds: { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 },
      occupancy: { dims: [0, 0, 0] as const, bits: new Uint8Array(0) },
    }));
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
  showGhost(partId: string, colorCode: number, transform: Mat4, valid: boolean): Promise<void>;
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

  private readonly scene: PlacementScene;

  constructor(scene: PlacementScene) {
    this.scene = scene;
  }

  /** The piece on the cursor. Null puts the tool back into selection. */
  hold(part: PartDef | null, colorCode = this.heldColor): void {
    this.held = part;
    this.heldColor = colorCode;
    this.previous = undefined;
    this.state = { candidates: [], index: 0, roll: 0, transform: null, valid: false };
    if (part === null) this.scene.hideGhost();
  }

  add(brick: PlacedBrick): void {
    this.bricks.set(brick.id, brick);
    this.index.insert(brick.id, brick.part, brick.transform);
  }

  remove(id: BrickId): void {
    this.bricks.delete(id);
    this.index.remove(id);
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
    await this.scene.showGhost(this.held.id, this.heldColor, transform, this.state.valid);
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
