# BrickYard

A browser-based brick building canvas. Pieces snap together using real connection geometry sourced
from the open LDraw parts library, so sideways building, clips, bars, axles, hinges and minifigures
all work without special-casing.

## Commands

```bash
npm run dev              # dev server on :5173
PORT=5174 npm run dev    # override port — required when multiple worktrees run at once
npm run build            # production build
npm run test             # vitest
npm run prebake          # regenerate the baked parts catalog
```

## Coordinate conventions

These are LDraw's, not ours, and getting them wrong is the most common source of bugs.

- **Units are LDU.** 1 LDU = 0.4 mm.
- **Y points DOWN.** `LDrawLoader` does not flip it; the scene root carries `rotation.x = π`.
- Stud pitch **20 LDU**. Plate height **8 LDU**. Brick height **24 LDU** (3 plates).
- Standard stud: radius **6**, height **4**.
- A connection point's axis is its **local +Y**, transformed by the part's orientation basis.

Positions are frequently non-integer (minifig joints sit at 45°). Never assume an integer lattice —
the model is continuous transforms, constrained by connection matching.

## Architecture

`docs/ARCHITECTURE.md` holds the type contracts. They are frozen; changing one is a deliberate,
announced act, not a drive-by edit.

UI work follows `docs/DESIGN.md`. Take every colour, size, radius and duration from
`src/styles/tokens.css` and build with the classes in `src/styles/components.css` — never a raw hex,
font name or px value. `design-language.html` renders the whole system in both themes.

`docs/LDRAW-PRIMER.md` covers the LDraw file format and the LDCad shadow library — line types,
transforms, meta commands, and the connectivity model. Read it before working in `src/snap/` or
`src/ldraw/`.

```
src/ldraw/     part fetch + cache, LDConfig colors, baked catalog
src/snap/      shadow parser, ConnectionPoint, compatibility, mating solver
src/model/     scene document, connection graph, operations, undo/redo
src/scene/     canvas, raycast, ghost preview, camera, motion, instancing
src/ui/        parts chest, color picker, inspector
src/workers/   part parsing, connectivity extraction
src/features/  restyle · pathtrace · omr · mcp
tools/         build-time prebake script
```

Two readers over the same files, deliberately decoupled: three's `LDrawLoader` for geometry, and our
own reader in `src/snap/` for connectivity. `src/snap/` and `src/model/` are pure — no three.js
imports, no DOM. Keep them that way; it is what makes them testable and worker-safe.

## Documentation rules

**Docs are state, not history.** Write what is true now, matter-of-factly. When a decision changes,
delete the superseded text rather than annotating it. Never "we tried X but chose Y", never
"formerly", never a changelog of reasoning. Git holds the history.

**Nothing in this repository — docs, comments, commit messages, or the deployed app — describes the
project's origin, purpose, or audience beyond what it does as a piece of software.**

## Working conventions

- Prefer small, focused commits with a working tree that builds.
- Pure modules (`src/snap/`, `src/model/`) require unit tests. Fixture-based tests use real part data
  captured under `src/snap/__fixtures__/`, never synthesized geometry.
- Performance is a feature. Parsing happens off the main thread; the render loop owns the frame.
- When several agents work in parallel, each owns disjoint files. Do not edit outside your slice —
  raise the conflict instead.

## Attribution

The parts corpus and its connectivity metadata are third-party open datasets. `README.md` carries the
required attributions; keep them accurate when adding a source.
