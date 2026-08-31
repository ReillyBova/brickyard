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
 * anti-aliased edges at grazing angles, and a distance-based alpha fade so the plane
 * reads as infinite rather than as a square that stops. Fog was the other option, but
 * fog would also dim the bricks sitting near the horizon; a per-dot fade in the shader
 * only touches the grid.
 */

import * as THREE from 'three';

import { readColorToken, watchTheme } from './theme.ts';

const STUD_PITCH = 20;
const DOT_OPACITY = 0.6;
/** Screen-space point diameter, in physical (device) pixels. */
const DOT_SIZE_PX = 3.5;
/** Fade starts this far from the camera and is fully gone by the far distance. */
const FADE_NEAR = 8 * STUD_PITCH;

const VERTEX_SHADER = /* glsl */ `
  uniform float uSize;
  varying float vDist;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vDist = distance(cameraPosition, worldPosition.xyz);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFadeNear;
  uniform float uFadeFar;
  varying float vDist;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float r = length(centered);
    if (r > 0.5) discard;

    float edge = 1.0 - smoothstep(0.35, 0.5, r);
    float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, vDist);
    float alpha = uOpacity * edge * fade;
    if (alpha <= 0.001) discard;

    gl_FragColor = vec4(uColor, alpha);
  }
`;

export interface BaseplateGrid extends THREE.Points {
  dispose: () => void;
  /** Number of stud dots drawn — for measurement/reporting, not used by the renderer. */
  readonly dotCount: number;
}

function buildDotPositions(studsPerSide: number): Float32Array {
  const pointsPerSide = studsPerSide + 1;
  const positions = new Float32Array(pointsPerSide * pointsPerSide * 3);
  const half = (studsPerSide * STUD_PITCH) / 2;
  let i = 0;
  for (let row = 0; row <= studsPerSide; row++) {
    const z = row * STUD_PITCH - half;
    for (let col = 0; col <= studsPerSide; col++) {
      const x = col * STUD_PITCH - half;
      positions[i++] = x;
      positions[i++] = 0;
      positions[i++] = z;
    }
  }
  return positions;
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
  const positions = buildDotPositions(studsPerSide);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Never included in bounds math: no bounding volume to compute, and nothing calls
  // setFromObject on this object or on the scene root that contains it.
  geometry.computeBoundingBox = () => {};
  geometry.computeBoundingSphere = () => {};

  const half = (studsPerSide * STUD_PITCH) / 2;
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x888888) },
      uOpacity: { value: DOT_OPACITY },
      uSize: { value: DOT_SIZE_PX * dpr },
      uFadeNear: { value: FADE_NEAR },
      uFadeFar: { value: half * 0.85 },
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
