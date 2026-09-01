# BrickYard

A browser-based brick building canvas. Snap pieces together the way real bricks do — including
sideways building, clips, bars, axles, hinges and minifigures — then restyle, render, or take apart
real published models.

Built with three.js and React. Runs entirely in the browser; no server, no account.

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

To run several instances at once (useful when working on branches in parallel):

```bash
PORT=5174 npm run dev
```

## How it works

Brick geometry comes from the [LDraw parts library](https://library.ldraw.org/), an open corpus of
several thousand parts. LDraw files describe geometry only — they carry no information about how
pieces attach — so connection data comes from the
[LDCad shadow library](https://github.com/RolandMelkert/LDCadShadowLibrary), which annotates LDraw
primitives with typed connection points:

```
p/stud.dat →  0 !LDCAD SNAP_CYL [ID=studC] [gender=M] [caps=one] [secs=R 6 4]
```

Because the annotations live on *primitives*, any part that references `stud.dat` inherits a stud
connector at that reference's transform. Walking a part's subfile tree and accumulating transforms
therefore yields its full connection geometry — with no per-part authoring, and with orientation
preserved, which is why sideways and angled building work without special cases.

Placement matches compatible connection points and solves the rigid transform that mates them.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the type contracts and module layout.

## Attribution

This project is not affiliated with or endorsed by the LEGO Group. LEGO® is a trademark of the LEGO
Group.

| Source | License |
| --- | --- |
| [LDraw Parts Library](https://library.ldraw.org/) | CC BY 2.0 |
| [LDCad Shadow Library](https://github.com/RolandMelkert/LDCadShadowLibrary) — Roland Melkert | CC BY-SA 4.0 |
| [LDraw Official Model Repository](https://library.ldraw.org/omr) | CC BY 4.0 |
| [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) | MIT |
| [three.js](https://threejs.org/) | MIT |
| [Poly Haven HDRIs](https://polyhaven.com/hdris) — seven of render mode's eight environment maps | CC0 |
| [Space Spheremaps](https://www.spacespheremaps.com/galactic-plane-spheremaps/) — TonyS, render mode's `space` environment map | CC BY 4.0 (attribution not required, but given) |

## License

MIT for the application code. Bundled part and model data retain their original licenses as listed
above.
