# Roadmap

What exists, what is being built, and what is still ahead. Ordered by dependency where one
thing genuinely blocks another, and by value where it does not.

---

## Shipped

The engine and the shell are real. Everything below is on `main`, tested, and reviewed.

| | |
| --- | --- |
| **Part sourcing** | Bulk mirror sync with conditional requests, offline reader, official `LDConfig` colors, prebake scaffold |
| **Connectivity** | Shadow-library parser resolving any part to typed connection points, with orientation preserved |
| **Compatibility and mating** | Profile matching, the mating solver, `findMates`, a 20 LDU spatial hash |
| **Collision** | Voxel occupancy at 4 LDU, query-time connection exemption, grid-indexed broad phase |
| **Document** | Immutable scene document, doubly-linked connection graph, ten invertible operations, transaction history |
| **Rendering** | `InstancedMesh` batching keyed by part and color, orbit camera, picking in LDU, ghost preview |
| **Placement** | Cursor-driven snap resolution, candidate scoring, collision-gated commit |
| **Design language** | 158 tokens, 95 component classes, both themes, the rendered reference page |
| **Interface** | Parts chest with real names and live thumbnails, color palette, floating rails, theme toggle |
| **Entry** | Landing page, hand-rolled routing, deep links that survive a reload on GitHub Pages |
| **Ground** | Themed viewport, dotted stud plane with distance falloff |
| **Storybook** | Component states in isolation, both themes, accessibility reporting |

---

## In flight

- **Editor session** — placement writing through the document and history rather than a private map. Unblocks selection, grouping, undo, save, restyle and graph inspection.
- **Snap sound** — synthesised click, scaled by how much engaged. Written; silent until commit is wired.
- **Model loading** — a bundled corpus of published models, MPD parsing with submodel flattening, graph solved on load, a real picker.
- **Visual polish** — palette shadow, dot size and contrast.

---

## Next

The essentials, roughly in dependency order.

1. **Chest to editor.** Nothing held by default; clicking a part holds it; placing releases it. Currently the sandbox seeds bricks and the chest is decorative.
2. **Directional keyboard control.** Arrows translate, rotation on keys that name their direction. No mnemonics.
3. **Selecting placed pieces.** Click to select when nothing is held, multi-select by modifier and marquee, delete.
4. **Grouping.** Group and ungroup, then transform and place a group as one thing.
5. **Undo and redo in the interface.** The history exists and is tested; the affordance does not. Labels are already written to read as user actions — "Rotate assembly", not "Transform 412 bricks".
6. **Save and load.** Document serialisation, and `.ldr` export so a model opens in Studio, LeoCAD or LDView. Note `.ldr` cannot carry our ids, so a round trip mints new ones.

---

## The original ambitions

These are why the project is shaped the way it is. The connection graph was built to make them
possible, not as an end in itself.

### Restyle

Bulk semantic recolor across a loaded model — an autumn version of a set that was never sold in
those colors. The strongest fit for "real control over iteration and variation": not a generate
button, but a handle on a model you already have. Cheap now that the document owns color and the
official palette is loaded, and it needs the document wiring above.

### Graph explode

Show the connection graph as itself: every piece a node, every connection an edge, laid out so the
structure of the model is legible. This is the thesis made visible — a brick model is a typed graph,
and nothing else in the tool says so directly. Depends on the graph being populated, which the editor
session delivers.

### Ray-traced render mode

Toggle from the live editor into a physically-based, progressively-accumulating render of whatever
is on the baseplate.

[`three-gpu-pathtracer`](https://github.com/gkjohnson/three-gpu-pathtracer) v0.0.24 (MIT) requires
three ≥ r180 and we are on r185, so it is compatible today. Its `WebGLPathTracer` takes a scene and
accumulates. Running it in a worker via `OffscreenCanvas` keeps interaction responsive while a frame
converges.

The interesting part is the material. ABS is not a plain diffuse plastic: it has a clearcoat-ish
specular lobe, slight subsurface scattering in light colors, and the LDraw palette already carries
finish classes — transparent, chrome, pearlescent, metallic, glitter, speckle, rubber, fabric — that
map onto real physical parameters rather than needing invention. Getting those right is what makes a
render read as *bricks* rather than as coloured geometry.

### Instruction playback

Published models retain `0 STEP` metadata, so build order is recoverable from the file — the parser
keeps it already. Pieces flying into place, step by step, is then an animation over data we have
rather than a feature needing new data.

### Claude integration

An MCP server exposing the document and the operation set, so a model can build and restyle through
the same transactions a person uses — and therefore cannot produce an invalid model, because the
connection graph validates every placement. The deployed app stands alone without it; MCP is a second
channel, demonstrated rather than required.

### Physics

Connected components as rigid bodies, so a structure can be knocked over and fall apart along its
real connections. The graph already answers "what is attached to what", which is the hard half.

### Symmetry and repeated structure

Detecting repeated subgraphs would find the sub-assemblies a model is actually made of — the four
identical wheel mounts, the repeated window bay — which is the raw material for generating
instructions that group work sensibly rather than one brick at a time.

---

## Known gaps and debt

Named so they are decisions rather than surprises.

- **The prebake pipeline is scaffolded, not built.** `connections.bin`, `geometry.bin` and the hosted
  per-part tier are specified in `docs/PREBAKE.md` and unimplemented. Thumbnails currently cost ~330 ms
  per part cold, ~6.9 s for a 31-part chest — that number is the argument.
- **No workers yet.** Parsing and graph solving run on the main thread. The protocol is defined and
  `snap/` and `model/` are pure, so migration is message passing rather than redesign.
- **`groundPlacement` is unverified.** Placement over empty space rests a piece on `y = 0` using part
  bounds; it has had no real scrutiny.
- **A mirrored brick still yields a mirrored placement.** `solveMating` canonicalises connector frames
  but inherits the target's world handedness. Nothing constructs one today, and what mirroring a brick
  *should* mean is a product question.
- **`public/404.html` hardcodes the base path.** It is a static file with no bundler, so it cannot read
  `BASE_URL`. Renaming the repo would silently break deep links.
- **No performance budget tests.** `npm run test:perf` is wired to a config that does not exist. The
  budgets in `docs/ARCHITECTURE.md` are unenforced.
- **Not deployed.** GitHub Pages base path and workflow are configured; nothing publishes yet.
- **Anchor and ray-march snapping.** Long pieces are awkward to place because the anchor on the held
  piece is chosen by continuity rather than by the cursor. Blender and Unity solve this by letting the
  cursor pick the anchor; Stud.io adds an explicit connect mode as an escape hatch. Deliberately
  deferred.
- **Part and color availability.** Which colors a part was actually produced in is not in LDraw at all;
  it needs an external inventory such as Rebrickable.
