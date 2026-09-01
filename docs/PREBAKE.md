# Prebake pipeline

Resolving one part cold costs roughly 20 network requests and several seconds, and a small published
model uses ~53 unique parts. Baking is not an optimisation, it is the load path.

```mermaid
flowchart LR
  subgraph UP["Upstream — touched once"]
    Z["complete.zip<br/>145 MB · one request · ETag"]
    S["shadow library zip<br/>1.7 MB · one request"]
  end
  subgraph LOCAL[".cache/ — gitignored, on disk"]
    M["local mirror<br/>parts · primitives · LDConfig · shadow"]
  end
  subgraph BAKE["npm run prebake — offline"]
    R["resolve<br/>walk trees, collect snaps"]
    O["occupancy<br/>voxelise at 4 LDU"]
    G["geometry<br/>flatten, dedupe, pack"]
  end
  subgraph OUT["public/baked/ — shipped"]
    C1["connections.bin<br/>all annotated parts"]
    C2["catalog.json<br/>chest metadata"]
    C3["geometry.bin<br/>chest parts only"]
    C4["models/*.manifest.json"]
    C5["occupancy.bin<br/>masks + bounds, all annotated parts"]
  end
  Z --> M
  S --> M
  M --> R --> C1
  R --> C2
  M --> O --> C5
  M --> G --> C3
  M --> C4
```

## Upstream politeness

**We mirror in bulk, once.** The full parts library is a single 145 MB zip and the shadow library a
single 1.7 MB zip. Fetching them individually would mean tens of thousands of requests against
volunteer-run infrastructure for exactly the same bytes.

Rules for `tools/sync-mirror.ts`:

- Bulk archives only. Never crawl the file APIs to build a mirror.
- Store `ETag` and `Last-Modified`; subsequent syncs send `If-None-Match` and stop at `304`.
- The mirror lives in `.cache/ldraw/`, which is gitignored and never deleted by the bake step.
- `npm run prebake` reads the mirror and **makes no network requests at all**. Re-baking a hundred
  times costs upstream nothing.
- Sync is a separate, explicit command. It is not run automatically by `dev`, `build`, or `test`.

```bash
npm run sync-mirror     # one conditional request per archive; usually a 304
npm run prebake         # fully offline
```

## Bundled, hosted, fetched

Three tiers, and the distinction between the first two matters:

| Tier | Delivered | Size ceiling | Contents |
| --- | --- | --- | --- |
| **Bundled** | to every visitor on load | a few MB | chest geometry, all connection data, catalog |
| **Hosted** | on demand, same origin | ~1 GB site limit | flattened geometry for the covered corpus |
| **Fetched** | on demand, upstream | none | the long tail, via worker tree-walk |

Bundling is what every visitor downloads, so it must stay small. **Hosting is not bundling** — a file
served on demand from our own origin costs nothing to visitors who never request it. GitHub Pages
allows a 1 GB published site and 100 GB of monthly bandwidth, which is far more than we need.

So we host pre-flattened geometry for the ~4,200 parts the shadow library covers — **one file per
part**, fetched on demand. One same-origin, HTTP/2, CDN-backed request per part, instead of ~20
cross-origin requests walking a subfile tree against a rate-limited third-party host.

### Why one file per part, and not packages

Part usage across 24 published models, spanning 29 to 4,511 parts:

| Measure | Value |
| --- | --- |
| Median unique parts per model | 89 |
| Distinct parts across the sample | 1,037 |
| Top 158 parts | cover 50% of usage |
| Top 789 parts | cover 90% of usage |
| Parts appearing in exactly one model | 600, or 58% of distinct parts |

The tail dominates: more than half of all distinct parts appear in a single model. Fixed-size
packages fail against that shape — a median model's 89 parts would scatter across most packages,
pulling tens of megabytes to obtain about 1.5 MB of useful geometry. Package layout would have to
follow co-occurrence to pay off, and with 58% singletons there is not enough co-occurrence to cluster
on.

Per-part files transfer exactly what a model needs (~1.5 MB at the median), multiplex over a single
HTTP/2 connection, and cache independently, so the second model a user opens reuses everything the
first one pulled. Geometry streams in and parts render as they arrive rather than blocking on the
full set.

Per-part size is estimated at ~17 KB pending the first full bake. If flattening proves materially
larger, the hosted set narrows to the most-used parts rather than growing the deploy — deploy time is
the binding constraint, since Pages times out at 10 minutes.

GitHub Pages serves its own cache headers and we cannot override them, so a service worker handles
long-lived caching of part geometry, which also makes previously-opened models work offline.

## What gets baked

### Connection data — the whole annotated corpus

Resolved `ConnectionPoint` sets for every part the shadow library covers (~4,200), packed binary:
orientation quantised to a quaternion, positions and radii as float32, section profiles
length-prefixed. Roughly 65 bytes per point, on the order of a few megabytes gzipped for the entire
corpus.

Shipping all of it means **snapping always works**, for any part in any model the user opens, with no
network round trip. This is the highest-value bake and the cheapest.

### Occupancy — masks and bounds for the whole annotated corpus

The 4 LDU occupancy mask and part-local bounds every collision query needs, packed binary: bounds as
six float32, then the mask bitfield, one bit per voxel.

Masks are long runs of solid and empty, so they compress about 13:1 — an ordinary brick is ~100
bytes gzipped and a 32x32 baseplate, the largest thing in the library, is 3.5 KB. The whole corpus is
well under a megabyte. Size grows as the cube of a part's extent, so if the large-panel end of the
corpus grows, per-row span encoding replaces the raw bitfield.

Separate from `connections.bin` because the two cover different sets — a part with no shadow
coverage still has a body that collides — go stale on different upstreams, and carry different
licences.

Shipping masks means **collision works the moment snapping does**, for any covered part, with no
geometry loaded and no network round trip. A part outside the corpus voxelises at runtime instead,
which costs milliseconds (`buildOccupancy`, `src/snap/collision.ts`).

### Geometry — the curated chest only

Flattened, deduplicated, packed vertex and index buffers for the parts in the chest. Geometry is
where the bytes are; the full corpus is far too large to ship, so this tier is bounded deliberately.
At the 20-part development chest, `geometry.bin` runs about 245 KB raw and 46 KB gzipped — roughly
2 KB gzipped per part — which is the number to watch as the chest grows toward a shipping-sized set.

The chest starts small during development — a few dozen parts — and grows to a curated popular set
before shipping. That is a bundle-size decision, not an upstream one.

`tools/bakeGeometry.ts` produces it by running three.js's own `LDrawLoader` under Node against the
mirror, rather than triangulating LDraw files from scratch: getting a face's winding right needs the
BFC state machine (`CERTIFY CW/CCW`, `INVERTNEXT`, mirrored reference matrices), and getting curved
primitives — studs, cylinders, minifig limbs — looking smooth on top of that needs `LDrawLoader`'s
edge-driven normal smoothing, which merges a shared vertex's normals only where no explicit line marks
that edge as a crease. Both are exactly what the runtime loader already does, so baked and
cold-fetched geometry for the same part cannot visually disagree — they're the same code path, one
fed from the mirror on disk instead of a network request. `LDrawLoader` normally resolves subfiles
through `fetch`; the bake instead walks each part's reference tree itself and seeds `THREE.Cache`
with what it finds, so `FileLoader` resolves every subfile from memory and the bake stays fully
offline. Deduplication comes from `BufferGeometryUtils.mergeVertices`, which welds vertices whose
position *and* normal already match — never across a smoothing seam — typically cutting vertex count
to about a third of the raw triangle soup.

None of the chest parts hardcode a subfile colour today (every reference resolves through LDraw's
colour-16 passthrough), so `PartGeometry.colorCodes` is unset for all of them; the field exists for
the day a printed or dual-moulded part joins the chest.

### Model manifests

For each bundled model: the list of unique parts it needs, and its solved connection graph. This
turns model loading from a serial discovery chain into one parallel prefetch, and skips the graph
solve entirely.

## Runtime fallback

Any part not in the baked chest still works.

```mermaid
flowchart TB
  N["part needed"] --> Q{"bundled in chest?"}
  Q -- yes --> H["instant, already in memory"]
  Q -- no --> S{"hosted flattened?"}
  S -- yes --> O["one same-origin request<br/>tens of milliseconds"]
  S -- no --> U["upstream tree walk in worker<br/>seconds, loading state"]
  O --> R["render"]
  U --> R
```

Connection data and occupancy masks are bundled for the entire annotated corpus, so snapping and
collision are available immediately for any covered part regardless of which geometry tier it falls
into. Only geometry is lazy. A part
outside the shadow library entirely still loads and renders — it simply has no connection points and
is placed freely.

Fetched geometry is cached in memory for the session. The upstream path is a genuine fallback,
expected to be rare once the hosted tier exists, and it never blocks the frame.

## Licensing of baked output

Hosting and bundling means redistributing, so the bake outputs carry upstream terms rather than the
application's licence:

- Geometry and occupancy masks derive from the LDraw parts library (**CC BY 2.0**) — attribution
  required.
- Connection data derives from the LDCad shadow library (**CC BY-SA 4.0**) — attribution **and
  share-alike**, so the baked connection files are themselves CC BY-SA 4.0.
- Model manifests derive from OMR models (**CC BY 4.0**).

The application code stays MIT. `public/baked/` ships a `LICENSE.txt` naming each upstream source and
its terms, and `README.md` carries the same attributions.

Build-time scripts in `tools/` are TypeScript, run directly by Node's native type stripping — no
build step, and no hand-written declaration files to drift out of sync with the code. They type-check
under `tsconfig.tools.json`.

## Determinism

The bake is a pure function of the mirror contents. `tools/prebake.ts` writes a manifest recording
the source library version, the shadow library commit, and a content hash of each output, so a stale
or partial bake is detectable rather than mysterious.

Baked masks pin the voxel size and fill semantics into shipped bytes, so the manifest also records
the occupancy format version. Changing `OCC_CELL` or what the mask counts as solid is a re-bake and a
version bump, not a code-only change.

## The output is committed

`public/baked/` is tracked, and Vite copies it into the build verbatim, so the deploy ships exactly
the bytes a developer generated. Nothing bakes during `build`, `test` or deploy: CI never needs a
mirror, and no build of this repository ever reaches upstream.

Re-bake and commit the result when one of three things changes:

- the mirror, after `npm run sync-mirror` reports anything other than a 304;
- the meaning of a baked field — the packed compatibility key, mating-section selection, connection
  id composition, occupancy cell size or fill rules;
- the set of parts baked, which today is the shadow library's coverage plus the chest.

A bake is a few seconds, so the cost of re-baking when unsure is nil, and the artifacts are a pure
function of the mirror: an unnecessary re-bake produces byte-identical files and no commit.

## Development loop

| Command | Network | Typical cost |
| --- | --- | --- |
| `npm run sync-mirror` | 2 conditional requests | seconds when unchanged |
| `npm run prebake` | none | 3s across cores, 15s on one |
| `npm run dev` | none | instant |
| `npm run test` | none | fast |

Only the first command talks to anyone else's server, and only when something upstream has actually
changed.
