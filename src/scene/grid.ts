/**
 * Baseplate grid, for spatial reference. Purely decorative: not a pick target, not a
 * baseplate part, and never counted in scene bounds (nothing calls `setFromObject` on
 * the scene root or on this object; `SceneRenderer.frameAll` only measures the brick
 * batch group).
 *
 * A stud grid is a lattice of points, not cells, so this is `THREE.Points` at the 20 LDU
 * stud pitch rather than `THREE.GridHelper`'s uniform lines. Dots are drawn in a small
 * shader: a fixed screen-space size (no perspective attenuation) so they never shrink
 * below a pixel and shimmer, a soft circular falloff inside the point sprite for
 * anti-aliased edges at grazing angles, and two independent fades:
 *
 * - A geometric edge fade near the finite buffer's boundary, based only on each dot's
 *   fixed distance from the plane center — never on camera distance — so the square
 *   buffer reads as boundless without ever depending on zoom.
 * - A continuous level-of-detail fade ("every other dot", described by the person who
 *   asked for it as "sort of like a Shepard tone"): every dot belongs to an integer
 *   octave `level` (how many times its stud index halves evenly — the center dot's is
 *   effectively infinite), and as the camera pulls back a *continuous* function of
 *   distance sweeps through the levels, cross-fading exactly one octave band at a time.
 *   Dots coarser than the current band stay fully opaque, so the lattice never empties
 *   out — it only ever thins to double spacing, forever, with no discrete pop and no
 *   moment where a level "switches". Zooming in runs the same function in reverse.
 */

import * as THREE from 'three';

import { readColorToken, watchTheme } from './theme.ts';

const STUD_PITCH = 20;
const DOT_OPACITY = 0.68;
/** Screen-space point diameter, in physical (device) pixels. */
const DOT_SIZE_PX = 8;
/**
 * Camera distance (LDU) at which the finest (20 LDU) lattice starts thinning. Chosen so
 * the full lattice is intact at the default framing distance (~650 LDU, see camera.ts)
 * and the first octave transition (20 -> 40 LDU spacing) completes by roughly double
 * that — matching perspective's own halving of apparent density, so the dots read at a
 * roughly constant on-screen density across zoom instead of visibly thinning in a burst.
 */
const LEVEL_REF_DISTANCE = 700;
/** A dot at the exact center (stud index 0 on both axes) never fades via LOD. */
const LEVEL_CENTER = 24;

const VERTEX_SHADER = /* glsl */ `
  uniform float uSize;
  uniform float uLevelRefDistance;
  uniform float uPlaneHalfExtent;
  attribute float aLevel;
  varying float vDist;
  varying float vLodFade;
  varying float vEdgeFade;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vDist = distance(cameraPosition, worldPosition.xyz);

    // Continuous octave level implied by camera distance. At t <= aLevel the dot is
    // coarser (or equal to) the currently-legible lattice and stays fully opaque; over
    // t in [aLevel, aLevel + 1) it is the one band cross-fading; past that it has been
    // absorbed into the next octave's gap. This is what makes the fade seamless: at any
    // instant exactly one octave band is in motion, never a hard switch.
    float t = log2(max(vDist, 1.0) / uLevelRefDistance);
    vLodFade = clamp(aLevel + 1.0 - t, 0.0, 1.0);

    // Geometric (not camera-distance) fade near the finite buffer's true edge, so the
    // plane reads as boundless without that fade ever being able to zero out the whole
    // grid just because the camera pulled back.
    float radius = length(position.xz);
    vEdgeFade = 1.0 - smoothstep(uPlaneHalfExtent * 0.82, uPlaneHalfExtent, radius);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vLodFade;
  varying float vEdgeFade;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float r = length(centered);
    if (r > 0.5) discard;

    float edge = 1.0 - smoothstep(0.35, 0.5, r);
    float alpha = uOpacity * edge * vLodFade * vEdgeFade;
    if (alpha <= 0.001) discard;

    gl_FragColor = vec4(uColor, alpha);
    // uColor came from readColorToken, which builds a THREE.Color from the CSS hex and
    // so is already converted into the renderer's linear working space. A raw
    // ShaderMaterial writes gl_FragColor straight to the framebuffer with no output
    // conversion of its own (built-in materials get one via this same chunk), so without
    // it the linear value is displayed as if it were already sRGB-encoded: a second,
    // uninvited gamma darkening on top of the first. That crushes a mid-value token like
    // dark theme's grid colour to nearly nothing against a dark ground while a lighter
    // token merely dims — which is why the dots vanished in dark mode specifically.
    #include <colorspace_fragment>
  }
`;

export interface BaseplateGrid extends THREE.Points {
  dispose: () => void;
  /** Number of stud dots drawn — for measurement/reporting, not used by the renderer. */
  readonly dotCount: number;
}

/**
 * Largest `k` such that integer `n` is divisible by `2^k`. `0` is treated as carrying
 * `LEVEL_CENTER` — arbitrarily coarse, so the origin dot never fades under any zoom.
 */
function octaveLevel(n: number): number {
  if (n === 0) return LEVEL_CENTER;
  let v = Math.abs(n);
  let level = 0;
  while (v % 2 === 0 && level < LEVEL_CENTER) {
    v /= 2;
    level++;
  }
  return level;
}

function buildDotAttributes(studsPerSide: number): {
  positions: Float32Array;
  levels: Float32Array;
} {
  const pointsPerSide = studsPerSide + 1;
  const count = pointsPerSide * pointsPerSide;
  const positions = new Float32Array(count * 3);
  const levels = new Float32Array(count);
  const half = (studsPerSide * STUD_PITCH) / 2;
  const centerIndex = studsPerSide / 2;
  let i = 0;
  let j = 0;
  for (let row = 0; row <= studsPerSide; row++) {
    const z = row * STUD_PITCH - half;
    const worldRow = row - centerIndex;
    for (let col = 0; col <= studsPerSide; col++) {
      const x = col * STUD_PITCH - half;
      const worldCol = col - centerIndex;
      positions[i++] = x;
      positions[i++] = 0;
      positions[i++] = z;
      levels[j++] = Math.min(octaveLevel(worldRow), octaveLevel(worldCol));
    }
  }
  return { positions, levels };
}

function applyGridColor(material: THREE.ShaderMaterial): void {
  const color = readColorToken('--by-canvas-grid', '#888888');
  (material.uniforms.uColor.value as THREE.Color).copy(color);
}

/**
 * A dotted plane at LDU `y = 0`: one dot per stud at the 20 LDU pitch, `studsPerSide`
 * studs wide. Sits as a child of the scene root, so it inherits the LDraw -> three flip
 * like everything else.
 *
 * Colour is read from `--by-canvas-grid` and re-applied whenever `data-theme` changes on
 * `<html>`; call `dispose()` (which also unwatches the theme) when the grid is torn down.
 */
export function createBaseplateGrid(studsPerSide = 48): BaseplateGrid {
  const { positions, levels } = buildDotAttributes(studsPerSide);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aLevel', new THREE.BufferAttribute(levels, 1));
  // Bounding volumes are left to three's normal computation (the renderer's transparent
  // sort reads geometry.boundingSphere internally and crashes if it's never set). Bounds
  // math elsewhere in the app never sees this object: `SceneRenderer.frameAll` only calls
  // `Box3.setFromObject` on the brick batch group, never on the scene root.

  const half = (studsPerSide * STUD_PITCH) / 2;
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x888888) },
      uOpacity: { value: DOT_OPACITY },
      uSize: { value: DOT_SIZE_PX * dpr },
      uLevelRefDistance: { value: LEVEL_REF_DISTANCE },
      uPlaneHalfExtent: { value: half },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material) as unknown as BaseplateGrid;
  points.name = 'baseplate-grid';
  points.position.set(0, 0, 0);
  points.raycast = () => {};
  points.frustumCulled = false;
  Object.defineProperty(points, 'dotCount', { value: (studsPerSide + 1) ** 2 });

  applyGridColor(material);
  const unwatch = watchTheme(() => applyGridColor(material));

  points.dispose = () => {
    unwatch();
    geometry.dispose();
    material.dispose();
  };

  return points;
}
