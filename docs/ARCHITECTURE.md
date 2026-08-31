# Architecture

The type contracts below are the interfaces every module builds against. Treat them as frozen:
changing one is a deliberate, announced act, because parallel work depends on their stability.

## Layers

```
        ┌───────────────────────────────────────────────┐
        │  ui/            React chrome, panels, chest    │
        ├───────────────────────────────────────────────┤
        │  scene/         three.js canvas, raycast,      │
        │                 instancing, ghost, motion      │
        ├──────────────────────┬────────────────────────┤
        │  model/              │  snap/                  │
        │  document, graph,    │  connection points,     │
        │  operations, undo    │  compatibility, mating  │
        ├──────────────────────┴────────────────────────┤
        │  ldraw/         fetch, cache, colors, catalog  │
        ├───────────────────────────────────────────────┤
        │  workers/       parsing off the main thread    │
        └───────────────────────────────────────────────┘
```

`snap/` and `model/` are **pure**: no three.js imports, no DOM access. This is what makes them
unit-testable and safe to run inside a worker. `scene/` depends on both; neither depends on `scene/`.

## Math conventions

```ts
type Vec3 = readonly [number, number, number];
/** Column-major, identical in layout to three.js `Matrix4.elements`. */
type Mat4 = readonly number[]; // length 16
/** Column-major 3×3 orientation basis. */
type Mat3 = readonly number[]; // length 9
```

Column-major throughout, matching `Matrix4.elements`, so transforms cross the `scene/` boundary with
zero conversion. Units are LDU and **Y points down** (see `CLAUDE.md`).

## Connection points

Derived from the LDCad shadow library during parsing. Immutable, part-local, computed once per part.

```ts
type SnapKind = 'cyl' | 'clip' | 'finger' | 'general';
type Gender = 'M' | 'F';
/** Round, Square, or Axle cross-section. */
type SectionVariant = 'R' | 'S' | 'A';

interface Section {
  variant: SectionVariant;
  radius: number;   // LDU
  length: number;   // LDU
}

interface ConnectionPoint {
  /** Stable within a part, derived from provenance + ordinal. */
  id: string;
  kind: SnapKind;
  gender: Gender;
  /** Profile along the axis. Length > 1 for stepped holes (e.g. Technic pin holes). */
  sections: Section[];
  position: Vec3;
  /** Part-local basis. The connector axis is local +Y. */
  orientation: Mat3;
  /** Connection permits sliding along its axis (Technic pins, bars). */
  slide: boolean;
  /** SNAP_GEN matching group; only meaningful when kind === 'general'. */
  group?: string;
  /** Source file, for debugging: 'p/stud.dat', 'parts/s/3001s01.dat'. */
  source: string;
}
```

Three properties of the real data drive this shape, all verified against the corpus:

- Orientation is a **full basis**, not an axis enum — minifig joints sit at 45°, and SNOT studs point
  along ±X/±Z.
- `sections` is an **array** — Technic pin holes have stepped profiles (`R 8 2 · R 6 16 · R 8 2`).
- A single primitive can emit **both genders** (`p/stud2.dat`, the open stud, is male on top and
  female below), so points are keyed by provenance rather than by part face.

## Parts

```ts
interface PartDef {
  id: string;               // '3001'
  title: string;            // 'Brick  2 x  4'
  connections: readonly ConnectionPoint[];
  bounds: { min: Vec3; max: Vec3 };
  category?: string;
}
```

Produced by the prebake step for the curated chest, and by a worker at runtime for arbitrary parts
appearing in a loaded model.

## Compatibility and mating

```ts
/** Can these two points connect at all? Pure, no geometry. */
function isCompatible(a: ConnectionPoint, b: ConnectionPoint): boolean;

/**
 * World transform placing `movingPart` so that its `movingPoint` mates `targetPoint`
 * (already in world space). `roll` rotates about the shared axis.
 */
function solveMating(
  movingPart: PartDef,
  movingPoint: ConnectionPoint,
  targetPoint: ConnectionPoint,
  targetWorld: Mat4,
  roll: number,
): Mat4;
```

Compatibility is **profile matching**, not merely kind + gender: opposite genders, compatible
section variants, and radii equal within tolerance. A round stud mates a square socket of the same
radius; an axle does not fit a round hole of equal radius.

## Scene document

```ts
type BrickId = string;
type GroupId = string;

interface BrickInstance {
  id: BrickId;
  partId: string;
  colorCode: number;    // LDraw color code, per LDConfig
  transform: Mat4;      // world, LDU
  groupId?: GroupId;
}

interface GroupDef {
  id: GroupId;
  name: string;
  parentId?: GroupId;
}

interface SceneDocument {
  bricks: ReadonlyMap<BrickId, BrickInstance>;
  groups: ReadonlyMap<GroupId, GroupDef>;
}
```

The document is the single source of truth. The rendered scene is a projection of it, never the
reverse.

## Connection graph

Derived state, cached, recomputed incrementally as operations apply.

```ts
interface ConnectionEdge {
  male:   { brick: BrickId; point: string };
  female: { brick: BrickId; point: string };
  kind: SnapKind;
}

interface ConnectionGraph {
  edges: readonly ConnectionEdge[];
  neighbors(id: BrickId): readonly BrickId[];
  /** Connected components — used by select-connected, grouping, and explode. */
  component(id: BrickId): ReadonlySet<BrickId>;
}
```

Edges are directed male → female. Direction records which piece owns the stud, which is what makes
"what is holding what" answerable.

## Operations and undo

Every mutation is an invertible operation carrying both sides of the change, so inversion never
needs to consult document state.

```ts
type Operation =
  | { type: 'add';       bricks: readonly BrickInstance[] }
  | { type: 'remove';    bricks: readonly BrickInstance[] }
  | { type: 'transform'; changes: readonly { id: BrickId; from: Mat4; to: Mat4 }[] }
  | { type: 'recolor';   changes: readonly { id: BrickId; from: number; to: number }[] }
  | { type: 'reparent';  changes: readonly { id: BrickId; from?: GroupId; to?: GroupId }[] }
  | { type: 'addGroup';    group: GroupDef }
  | { type: 'removeGroup'; group: GroupDef };

/** A single user-visible undo step; one gesture may produce several operations. */
interface Transaction {
  label: string;          // 'Move 4 bricks'
  ops: readonly Operation[];
}

function applyOperation(doc: SceneDocument, op: Operation): SceneDocument;
function invertOperation(op: Operation): Operation;
```

The full editing surface — multi-select, rotate, duplicate, copy/paste, group/ungroup, mirror,
recolor, hide/isolate, select-connected — composes from these primitives. Selection and visibility
are view state and live outside the document, so they are not undoable.

## Snap resolution

The interface is fixed here; the **scoring function is the product**, and is owned directly rather
than delegated.

```ts
interface SnapCandidate {
  movingPoint: string;      // ConnectionPoint id on the piece being placed
  target: { brick: BrickId; point: string };
  transform: Mat4;          // result of solveMating
  score: number;            // higher wins
}

interface SnapQuery {
  part: PartDef;
  /** Cursor ray in world space. */
  rayOrigin: Vec3;
  rayDirection: Vec3;
  /** Current roll about the connection axis, in quarter turns. */
  roll: number;
}

function resolveSnap(query: SnapQuery, index: SpatialIndex): SnapCandidate[];
```

Candidate lookup uses a uniform spatial hash over world-space connection points, cell size 20 LDU
(one stud pitch), rebuilt incrementally as bricks move.

```ts
interface SpatialIndex {
  insert(brick: BrickId, part: PartDef, transform: Mat4): void;
  remove(brick: BrickId): void;
  near(point: Vec3, radius: number): readonly { brick: BrickId; point: string }[];
}
```

## Worker protocol

Requests are correlated by `id`. Geometry crosses as transferable typed arrays.

```ts
type WorkerRequest =
  | { id: number; kind: 'resolvePart';  partId: string }
  | { id: number; kind: 'parseModel';   text: string; name: string };

type WorkerResponse =
  | { id: number; ok: true;  kind: 'resolvePart'; part: PartDef }
  | { id: number; ok: true;  kind: 'parseModel';  bricks: BrickInstance[]; parts: PartDef[] }
  | { id: number; ok: false; error: string }
  | { id: number; progress: number };   // 0..1, for large models
```

Cold-resolving a single part costs roughly 20 network fetches and several seconds, so the curated
chest is baked at build time and the worker path serves only arbitrary parts from loaded models.

## Fallback behaviour

A part with no shadow-library coverage yields `connections: []`. It still loads and renders, and is
placeable freely without snapping. Missing connectivity degrades the experience for that piece; it
never blocks the model.
