# Brickyard — Product Spec

## What we're building

A browser-based brick building canvas where pieces snap together the way real bricks do. Start from
an empty baseplate and build from a parts chest, or load a real published model and take it apart.

The bet is **fidelity of connection**: not a grid that stacks bricks on top of each other, but a
typed connection model supporting sideways building, clips, bars, axles, hinges and minifigures — so
a modern model loads and stays editable.

Bricks are toys. The tool should feel like one.

## User flow

Two entry points, one canvas:

- **Sandbox** — empty baseplate, parts chest, build from scratch.
- **Load a model** — open a published model from the LDraw Official Model Repository, then modify it.

**Editing operations** are the real surface area, not an afterthought: hover/select, multi-select
(marquee and modifier), place, move, rotate (about connection axes and free), delete,
duplicate/clone, copy/paste, group/ungroup, mirror, recolor, hide/isolate, select-connected, and
undo/redo across all of it. Getting this set complete and consistent is the core work.

## How it works

LDraw files describe geometry only — a `.dat` carries no information about how parts attach. The
LDCad shadow library supplies that, annotating LDraw *primitives* with typed connection points:

```
p/stud.dat →  0 !LDCAD SNAP_CYL [ID=studC] [gender=M] [caps=one] [secs=R 6 4]
```

Every part referencing `stud.dat` inherits a male stud connector at that reference's transform. 87
annotated primitives cover the modern connection vocabulary — studs (including `hipstud` for
studs-not-on-top), clips, bars, axles, Technic pin holes, ball joints and hinge fingers — plus 4,164
part-specific annotations. Minifig arms and hands are annotated explicitly, and the hand is a clip,
so minifigs hold accessories through a real modeled connection.

Walking a part's subfile tree while accumulating transforms therefore yields its complete connection
geometry, with orientation preserved and no per-part authoring.

Two layers stay distinct: the shadow library defines how pieces **can** connect; our graph records
how they **are** connected.

Snapping gathers connection points near the cursor ray, filters by compatibility, solves the rigid
transform that mates the chosen pair, previews it, and commits on click. Because points carry full
orientation, sideways and angled building fall out of the model rather than being special-cased.

## Tech stack

Vite, React and TypeScript, with three.js r185 used directly — placement and animation are
imperative per-frame work. A static SPA with no backend.

## Architecture

Type contracts and module layout live in [`ARCHITECTURE.md`](ARCHITECTURE.md).

Geometry comes from three's `LDrawLoader`, which caches per part and returns clones sharing
`BufferGeometry`, giving one mesh per instance with its own matrix — mutation is a matrix write,
never a re-merge. Draw calls are the cost, addressed with an `InstancedMesh` layer keyed by
`(partId, colorCode)`.

Connectivity comes from a separate pure reader over LDraw reference lines. Cold-resolving one part
costs roughly 20 network fetches and several seconds, so the curated chest is baked at build time
and a web worker handles arbitrary parts from loaded models, keeping the main thread for rendering.

## Scope

**Core:** snapping that feels good, the full operation set above, parts chest, color, minifigures.

**Planned extensions:** loading published models, bulk semantic recolor, a path-traced render mode,
an MCP server for programmatic building, and animation.

**Out of scope:** flexible parts (hoses, string), gear meshing, stickers and decals, Technic
friction and slide constraints, and Duplo. These are the genuine hard cases in an 18,000-part corpus,
and none of them block editing a modern model.

## Known risks

1. **Snap ambiguity.** Many candidate connection points sit near the cursor at once; choosing the one
   the user meant is the central interaction problem of the project.
2. **Model load performance.** A large model is thousands of parts. Instancing, workers and prebaking
   address it, against a measured budget rather than an assumed one.
3. **Coverage gaps.** An unannotated part yields no connection points, and falls back to free
   placement rather than failing to load.
