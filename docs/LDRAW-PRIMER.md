# LDraw and LDCad — a working primer

Enough of the two file formats to work on this codebase without reading the full specifications.
Links to the authoritative documents are at the bottom.

## LDraw

An open, plain-text CAD format for brick models, with a parts library of ~18,000 parts under CC BY 2.0.
A `.dat` file describes **geometry only**. It says nothing about how parts attach.

### Units and axes

- **1 LDU** (LDraw Unit) = 0.4 mm.
- **+Y points down.** +X is right, +Z is toward the viewer.
- Stud pitch **20 LDU**; plate height **8 LDU**; brick height **24 LDU** = 3 plates.
- A standard stud is radius **6**, height **4**.

A 2×4 brick therefore spans 80 × 24 × 40 LDU, with its studs on the `y = 0` face and its open
underside at `y = 24`.

### Line types

Every line begins with an integer type.

| Type | Meaning |
| --- | --- |
| `0` | Comment or meta command |
| `1` | Reference to another file, with color and transform |
| `2` | Line segment |
| `3` | Triangle |
| `4` | Quadrilateral |
| `5` | Optional (conditional) line |

Only types `0` and `1` matter for connectivity. Type `1` is the one that carries structure:

```
1 <colour> x y z  a b c  d e f  g h i  <file>
```

which is the 4×4 transform

```
| a b c x |
| d e f y |
| g h i z |
| 0 0 0 1 |
```

applied to everything inside `<file>`. References nest arbitrarily, and paths use backslashes
(`s\3001s01.dat`). Resolution searches `parts/`, `p/`, then `models/`.

So a part is a tree of transformed references bottoming out in triangles. Walking that tree while
multiplying transforms is the central operation in `src/snap/`.

### Color

Color `16` means "inherit from the parent reference", which is how one part file renders in any
color. Color `24` is the matching edge color. All other codes index the official palette defined
in `LDConfig.ldr`, which also carries alpha, luminance, and material class (chrome, pearlescent,
metallic, rubber, glitter).

### Models and MPD

A model file lists type-`1` references to parts. An **MPD** packs a model and its submodels into one
file, split by `0 FILE <name>` headers; a submodel is then referenced exactly like a part. Submodels
carry arbitrary rotations, so nothing may assume axis alignment.

`0 STEP` separates build steps. Published models in the Official Model Repository (CC BY 4.0) retain
them, so build order is recoverable from the file.

## LDCad shadow library

Connectivity comes from a separate open dataset (CC BY-SA 4.0) that "patches" LDraw files. A shadow
file has the same relative path as the LDraw file it annotates, and its contents are merged with
that file during loading.

The important structural fact: **most annotations sit on primitives, not on parts.** `p/stud.dat` is
annotated once, so every part referencing a stud inherits a stud connector at that reference's
transform. 87 annotated primitives plus ~4,164 part-specific files cover the library.

### Meta commands

All take the form `0 !LDCAD <COMMAND> [key=value] [key=value] …`.

| Command | Describes |
| --- | --- |
| `SNAP_CYL` | Cylindrical pegs and holes — studs, bars, axles, pin holes. The workhorse. |
| `SNAP_CLP` | Clip shapes, which grip male cylinders. |
| `SNAP_FGR` | Interlocking hinge fingers. Match only against each other. |
| `SNAP_GEN` | Irregular shapes, matched by a named `group`. |
| `SNAP_INCL` | Includes another shadow file's snaps at a given transform. |
| `SNAP_CLEAR` | Removes inherited snaps, so a part can override a primitive. |

Common attributes:

- `pos` / `ori` — position and 3×3 orientation, relative to the annotated file. **The connector axis
  is local +Y.**
- `gender` — `M` (male, a peg) or `F` (female, a hole).
- `secs` — cross-section profile as repeated `<variant> <radius> <length>`, where variant is `R`
  round, `S` square, or `A` axle. Multiple sections describe stepped holes, e.g. a Technic pin hole
  is `R 8 2  R 6 16  R 8 2`.
- `grid` — replicates the snap over a lattice: `[C]<countX> [C]<countZ> <spacingX> <spacingZ>`,
  where `C` centres that axis. This is how a 2×4 underside declares 8 sockets in one line.
- `slide` — the connection permits sliding along its axis (bars, Technic pins).
- `caps` — which ends of the cylinder are closed.

### Worked example

`3001.dat` (Brick 2×4) resolves to 16 connection points:

- 8 male `R 6 4` studs at `y = 0`, inherited from `p/stud.dat` at eight reference transforms.
- 8 female `R 6 20` sockets at `y = 24`, from a single `grid` annotation on the subpart
  `parts/s/3001s01.dat`.

Three behaviours worth internalising, each of which breaks a naive model:

1. **Orientation is arbitrary.** `4070` (headlight brick) has a stud on `axis=[0,0,1]`; a minifig arm
   has one on `axis=[0, 0.707, -0.707]`. There is no lattice.
2. **Profiles are stepped.** Matching on a single radius is wrong for Technic holes.
3. **One primitive can emit both genders.** `p/stud2.dat`, the open stud, is male on top and female
   just below, which is why hollow studs accept bars.

## References

- [LDraw File Format Specification](https://ldraw.org/article/218.html)
- [LDraw Official Model Repository specification](https://www.ldraw.org/article/593.html)
- [LDCad meta command reference](https://www.melkert.net/LDCad/tech/meta)
- [LDCad shadow library overview](https://www.melkert.net/LDCad/tech/shadowLib)
