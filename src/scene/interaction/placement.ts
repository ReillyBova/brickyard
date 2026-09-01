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

import { IDENTITY, basisOf, fromBasis, fromYRotation, invert, multiply } from '../../math';
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
 * The angle of a matrix known to be a pure rotation about local Y — `fromYRotation`'s
 * inverse. Only ever called on a delta between two such rotations (see `move()`'s
 * pick-up seeding), never on an arbitrary matrix, so no general-purpose decomposition
 * is needed: `gl-matrix`'s own `fromYRotation` writes `m[0] = cos`, `m[8] = sin`.
 */
function angleOfYRotation(m: Mat4): number {
  return Math.atan2(m[8], m[0]);
}

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
  /**
   * The last transform `resolveSnap`/`groundPlacement` actually produced. What, if
   * anything, still needs composing on top of it depends on `baseIsSolved` — see
   * `composed()`.
   */
  private baseTransform: Mat4 | null = null;
  /**
   * Whether `baseTransform` came from a connector solve (`resolveSnap` found a
   * candidate) rather than the ground fallback. A solved base already has
   * `manualRoll` baked in — see `move()` — because `solveMating` was given the total
   * roll directly; `composed()` must not layer it on again on top of that. A ground
   * placement has no connector to solve against, so its rotation is still applied by
   * `composed()` the ordinary way.
   */
  private baseIsSolved = false;
  /**
   * A persistent extra spin about the connection axis (the same axis `state.roll`'s
   * quarter turns already rotate about — see CLAUDE.md's "connection point's axis is
   * its local +Y"), in radians, on top of whatever `state.roll` contributes. Reset on
   * `hold`/`pickUp`, exactly like `state.roll` already was — a fresh piece never
   * inherits the last one's spin.
   *
   * This used to be a matrix composed onto `baseTransform` *after* the mating solve
   * ran — which looked right for a connector at the piece's own centre, and produced
   * exactly the reported bug otherwise: `solveMating` aligns a connector assuming no
   * further rotation is coming, so composing one on afterwards swings that connector
   * away from the target by however far it sits from the piece's origin — a half
   * stud pitch in each direction for a piece like a 2x3, i.e. landing *between* studs
   * rather than on one. Keeping this as a scalar and feeding `state.roll + manualRoll`
   * into `resolveSnap` (see `move()`) instead means the solve itself places the
   * connector correctly no matter how much extra spin is dialled in — `solveMating`
   * already takes a `roll` for exactly this, just previously only ever fed the
   * discrete quarter-turns from the 'r' key.
   */
  private manualRoll = 0;
  /**
   * Set by `pickUp`, consumed by the first `move()` that resolves a real base — a
   * picked-up piece's own orientation, waiting to be re-expressed as `manualRoll` (a
   * connector-relative roll) once there is a base — and, for the connector-solved
   * case, a chosen connector — to express it against. A fresh chest hold never sets
   * this, since there is no prior orientation to preserve; `manualRoll` starting at
   * `0` already covers that case.
   */
  private pendingRotationSeed: Mat4 | null = null;

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
    this.baseTransform = null;
    this.baseIsSolved = false;
    this.manualRoll = 0;
    this.pendingRotationSeed = null;
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
   * over some other candidate the cursor happens to be closer to. It also seeds
   * `pendingRotationSeed`, so the piece keeps the orientation it was actually sitting
   * in rather than resetting to whatever bare orientation the next resolved base
   * happens to have — the piece hasn't changed, only what's holding it has. See the
   * comment on `move()` for how the seed is turned into `manualRoll` once a real base
   * exists to express it against.
   */
  pickUp(part: PartDef, colorCode: number, previousTransform: Mat4): void {
    this.held = part;
    this.heldColor = colorCode;
    this.wasPickedUp = true;
    this.previous = previousTransform;
    this.baseTransform = null;
    this.baseIsSolved = false;
    this.manualRoll = 0;
    this.pendingRotationSeed = previousTransform;
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

  /**
   * `baseTransform`, with `manualRoll` composed on top only when it isn't already
   * baked in. A connector-solved base already has the full `state.roll + manualRoll`
   * folded into the solve itself (see `move()`), so composing it again here would
   * apply it twice — once correctly, about the connector the solve aligned, and once
   * more about the piece's own local origin, right back into the original bug. A
   * ground-fallback base has no connector to solve against, so its rotation is still
   * applied here the ordinary way, about the piece's own origin.
   */
  private composed(): Mat4 | null {
    if (this.baseTransform === null) return null;
    if (this.baseIsSolved) return this.baseTransform;
    return multiply(this.baseTransform, fromYRotation(this.manualRoll));
  }

  /** Re-evaluates `state` from a new `baseTransform`: collision, and the ghost repaint. */
  private applyBase(base: Mat4 | null, solved: boolean): Mat4 | null {
    const part = this.held;
    this.baseTransform = base;
    this.baseIsSolved = solved;
    const transform = part === null ? null : this.composed();
    this.state = {
      ...this.state,
      transform,
      valid: part === null || transform === null ? false : !collides(part, transform, this.index),
    };
    this.previous = transform ?? undefined;
    void this.paint();
    return transform;
  }

  /** Recompute from the pointer. Returns the transform the ghost should show. */
  move(ndcX: number, ndcY: number): Mat4 | null {
    const part = this.held;
    if (part === null) return null;

    const hit = this.scene.pick(ndcX, ndcY);
    const ray = this.scene.pickRay(ndcX, ndcY);
    // `solveMating`'s `roll` is quarter turns but accepts any real number — the
    // fractional part is exactly the persistent spin `manualRoll` (radians) contributes
    // once converted to the same units. Feeding the *total* orientation into the solve,
    // rather than resolving at `state.roll` alone and composing `manualRoll` onto the
    // result afterwards, is what keeps the connector the solve aligned from swinging
    // away from the target — see the comment on `manualRoll` above.
    const totalRoll = this.state.roll + this.manualRoll / (Math.PI / 2);
    const candidates = resolveSnap(
      {
        part,
        rayOrigin: ray.origin,
        rayDirection: ray.direction,
        ...(hit ? { hit } : {}),
        ...(this.previous ? { previous: this.previous } : {}),
        roll: totalRoll,
      },
      this.index,
      this.lookup,
    );

    let base: Mat4 | null = null;
    let solved = false;
    if (candidates.length > 0) {
      base = candidates[0].transform;
      solved = true;
    } else if (!hit) {
      // Over empty space: rest it on the baseplate rather than showing nothing.
      const ray = this.scene.pickRay(ndcX, ndcY);
      base = groundPlacement(part, ray.origin, ray.direction);
    }

    this.state = { ...this.state, candidates, index: 0 };

    // Re-express a pending pick-up orientation as `manualRoll` as soon as there's a
    // real base to express it against — deferred rather than done in pickUp() itself,
    // since neither the base nor (for the solved case) which connector it chose is
    // known until resolveSnap/groundPlacement runs here.
    if (base !== null && this.pendingRotationSeed !== null) {
      const baseRotation = fromBasis(basisOf(base), [0, 0, 0]);
      const previousRotation = fromBasis(basisOf(this.pendingRotationSeed), [0, 0, 0]);
      const delta = multiply(invert(baseRotation), previousRotation);
      this.pendingRotationSeed = null;
      if (solved) {
        // `delta` is the extra spin, about the connector's own axis, needed on top of
        // this candidate's roll-0 solve to reproduce the piece's actual prior
        // rotation — true because every rotation this codebase ever applies to a
        // mated piece (this seed included, transitively) is itself a turn about some
        // connector's own axis, so the accumulated difference from a fresh solve is
        // always expressible as one. Folding it into `manualRoll` and re-resolving
        // (rather than composing `delta` onto `base` directly) is what bakes it into
        // the solve, so the mated connector lands exactly on target, not offset by
        // the same half-stud error this whole fix exists to remove.
        this.manualRoll += angleOfYRotation(delta);
        return this.move(ndcX, ndcY);
      }
      // No connector to solve against — the ground fallback has no roll to feed, so
      // the seeded rotation is simply the extra spin composed the ordinary way.
      this.manualRoll = angleOfYRotation(delta);
    }

    return this.applyBase(base, solved);
  }

  /** Cycle to the next candidate. Cuts, never tweens — see docs/DESIGN.md. */
  cycle(): void {
    if (this.state.candidates.length < 2) return;
    const index = (this.state.index + 1) % this.state.candidates.length;
    this.state = { ...this.state, index };
    // Every candidate in state.candidates came from the same resolveSnap call in
    // move(), solved with the current total roll already baked in.
    this.applyBase(this.state.candidates[index].transform, true);
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

  /**
   * A persistent extra spin about the connection axis, layered on top of whatever
   * `state.roll` and the cursor resolve — not a one-off transform mutation `move`
   * would silently discard on the very next hover. That was the actual bug behind
   * three separate reports: a rotation applied via a raw `nudge`-style mutation lived
   * only in `state.transform`, which the next pointer move overwrote wholesale by
   * re-deriving it from `resolveSnap` with the *stale* pre-rotation `roll` — so the
   * rotation vanished on the next hover (looked like "rotating a ghost doesn't
   * persist"), or on commit, since `commitHeld` always resolves once more at the
   * click position before committing (looked like "committed orientation doesn't
   * match the ghost" and, transitively, "the collision/valid state goes stale after a
   * transform" — the same silent overwrite discards the freshly-recomputed `valid`
   * too). Storing it in `manualRoll`, which `move()` feeds into the solve on every
   * call, is what makes it survive: every future `move()` or `cycle()` still reflects
   * it, because it's an input the solve sees, not a mutation layered on the solve's
   * output.
   *
   * Takes the last pointer position, for the same reason `rotate()` does: changing
   * the roll alone leaves the ghost showing the old orientation until the pointer
   * happens to move, which reads as the key not working. It matters more here than
   * for `rotate()`, because when a connector has been solved (`baseIsSolved`), the new
   * roll has to be *fed back into that same solve* to keep the mated connector on
   * target (see `move()`) — there is no cheaper way to recompute it than re-resolving.
   * Without a pointer position to re-resolve at, the spin is still recorded (never
   * gated — see below) and simply takes effect on the next real cursor move, exactly
   * as `rotate()`'s roll does when called without one.
   *
   * Never gated on `baseTransform` being set, `state.valid`, or there being any
   * candidates at all: rotating is how a user *searches* for a valid placement, so
   * refusing the input exactly when the current position doesn't work yet would
   * refuse it exactly when it's needed most. A piece floating over empty space with no
   * candidate still records the spin here — there is simply no base yet for it to take
   * effect on, the same as for every other base change.
   */
  rotateManually(angleRadians: number, ndc?: readonly [number, number]): Mat4 | null {
    if (this.held === null) return null;
    this.manualRoll += angleRadians;

    if (this.baseIsSolved) {
      if (ndc) return this.move(ndc[0], ndc[1]);
      return this.state.transform;
    }

    // No connector was solved (ground fallback, or nothing resolved yet) — there is no
    // aligned connector a post-hoc rotation could swing away from, so composing it
    // directly here, without a raycast, is correct and immediate.
    const transform = this.composed();
    this.state = {
      ...this.state,
      transform,
      valid: transform === null ? false : !collides(this.held, transform, this.index),
    };
    this.previous = transform ?? undefined;
    void this.paint();
    return transform;
  }

  /**
   * Nudge the piece on the cursor by a rigid world-space `delta` — the same keyboard
   * vocabulary a placed selection uses (`EditorSession.transformSelection`), applied
   * to the ghost instead of a document brick. Composed into `baseTransform` directly
   * (carrying `baseIsSolved` through unchanged, since a pure translation doesn't
   * touch orientation), so a translate nudge followed by a rotate — or the other way
   * around — both apply against where the piece actually is, not a stale pre-nudge
   * position.
   *
   * Deliberately *not* persistent the way `rotateManually` is: the very next cursor
   * move legitimately supersedes it, because "the ghost follows the cursor" is the
   * whole point of placement, and unlike orientation, position has an obvious next
   * authority — wherever the mouse is. It does survive to a commit that happens
   * without an intervening cursor move, which is the case that actually matters.
   */
  nudge(delta: Mat4): Mat4 | null {
    if (this.held === null || this.baseTransform === null) return null;
    return this.applyBase(multiply(delta, this.baseTransform), this.baseIsSolved);
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

    // Clear the committed placement AND release the hold: "place" commits and
    // releases in one step, per the interaction model — a piece never stays on the
    // cursor after landing. This used to leave `held` set, relying on the caller to
    // separately call `hold(null)` afterward; that worked for a fresh chest choice
    // only because committing there happens to trigger a prop round-trip that calls
    // it, and did nothing for a picked-up piece, which has no such round-trip — so a
    // placed-and-released pickup stayed stuck on the cursor until Escape.
    this.held = null;
    this.state = {
      candidates: [],
      index: 0,
      roll: this.state.roll,
      transform: null,
      valid: false,
    };
    this.previous = undefined;
    this.wasPickedUp = false;
    this.baseTransform = null;
    this.baseIsSolved = false;
    this.manualRoll = 0;
    this.pendingRotationSeed = null;
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
