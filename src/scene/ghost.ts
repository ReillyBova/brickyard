/**
 * Ghost preview: a translucent render of a part at a candidate transform, with a
 * valid/invalid visual state, and an optional wireframe mode for a piece picked back
 * up off the baseplate rather than chosen fresh from the chest. This is mechanism
 * only — imperative show/hide — not behaviour. When it appears, where it moves, and
 * how the part and transform are chosen are the interaction layer's business.
 *
 * Three renderings share one mesh pair (fill + edges), which is always drawn instead
 * of the solid mesh whenever either applies:
 *
 * - Solid (valid, freshly chosen): the mesh from `docs/DESIGN.md` ("Ghost: solid
 *   geometry, no wireframe"), depth-tested normally. It never overlaps placed
 *   geometry, so ordinary depth testing never fights.
 * - Outline, `--by-3d-ghost` (valid, picked up): a piece being relocated rather than
 *   placed new reads as "this already exists, you're moving it" rather than "here is
 *   a new one" — the same distinction a cut-and-paste marquee draws in a 2D editor.
 * - Outline, `--by-3d-invalid` (invalid, either origin): a collision by definition
 *   overlaps placed geometry, so the solid mesh would z-fight it — coplanar and
 *   crossing faces flicker as the depth buffer can't consistently resolve which
 *   surface is "in front". Polygon offset only fixes a coplanar *seam*; a piece
 *   genuinely sunk into another crosses the depth buffer repeatedly through the whole
 *   overlap volume, which offset does nothing for. So this state switches to
 *   `depthTest: false` — there is nothing left to fight because it stops comparing
 *   depth at all, and drawn on top of everything it reads correctly as an overlay: a
 *   proposal, not real geometry.
 *
 * Both outline states use the same geometry treatment: `THREE.EdgesGeometry` (hard
 * silhouette lines only — not `WireframeGeometry`, which draws every triangulation
 * diagonal across flat faces and looks like a debug view) plus a faint fill, so the
 * shape still reads as a shape.
 */

import * as THREE from 'three';

import type { Mat4 } from '../types';

import { readColorToken, readNumberToken, watchTheme } from './theme.ts';

/** Hard silhouette edges only — coplanar faces don't get an interior diagonal drawn. */
const EDGE_THRESHOLD_DEGREES = 15;

export class GhostPreview {
  /** Group so the solid mesh and the outline (fill + edges) can swap visibility. */
  readonly mesh: THREE.Group;

  private readonly solidMesh: THREE.Mesh;
  private readonly solidMaterial: THREE.MeshStandardMaterial;

  private readonly outlineFill: THREE.Mesh;
  private readonly outlineFillMaterial: THREE.MeshBasicMaterial;
  private readonly outlineEdges: THREE.LineSegments;
  private readonly outlineEdgesMaterial: THREE.LineBasicMaterial;

  private currentGeometry: THREE.BufferGeometry | null = null;
  private edgesGeometry: THREE.BufferGeometry | null = null;
  private valid = true;
  /** Forces the outline treatment even when valid — see the class doc's second case. */
  private wireframe = false;
  private readonly unwatchTheme: () => void;

  constructor() {
    this.solidMaterial = new THREE.MeshStandardMaterial({
      transparent: true,
      depthWrite: false,
    });
    this.solidMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.solidMaterial);
    this.solidMesh.raycast = () => {};

    this.outlineFillMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.outlineFill = new THREE.Mesh(new THREE.BufferGeometry(), this.outlineFillMaterial);
    this.outlineFill.raycast = () => {};
    // Draws after the solid batches regardless of submission order.
    this.outlineFill.renderOrder = 10;

    this.outlineEdgesMaterial = new THREE.LineBasicMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.outlineEdges = new THREE.LineSegments(new THREE.BufferGeometry(), this.outlineEdgesMaterial);
    this.outlineEdges.raycast = () => {};
    this.outlineEdges.renderOrder = 11;

    this.mesh = new THREE.Group();
    this.mesh.add(this.solidMesh, this.outlineFill, this.outlineEdges);
    this.mesh.visible = false;
    this.applyVisibility();

    this.applyTheme();
    this.unwatchTheme = watchTheme(() => this.applyTheme());
  }

  private applyTheme(): void {
    const ghostAlpha = readNumberToken('--by-3d-ghost-alpha', 0.45);
    const outlineFillAlpha = readNumberToken('--by-3d-invalid-alpha', 0.18);
    const ghostColor = readColorToken('--by-3d-ghost', '#4caf50');
    const invalidColor = readColorToken('--by-3d-invalid', '#e53935');
    const outlineColor = this.valid ? ghostColor : invalidColor;

    this.solidMaterial.opacity = ghostAlpha;
    this.solidMaterial.color.copy(ghostColor);

    this.outlineFillMaterial.opacity = outlineFillAlpha;
    this.outlineFillMaterial.color.copy(outlineColor);
    this.outlineEdgesMaterial.color.copy(outlineColor);
  }

  /** Solid mesh only when valid and not forced to wireframe; the outline otherwise. */
  private applyVisibility(): void {
    const outline = this.wireframe || !this.valid;
    this.solidMesh.visible = !outline;
    this.outlineFill.visible = outline;
    this.outlineEdges.visible = outline;
  }

  private rebuildEdgesIfNeeded(geometry: THREE.BufferGeometry): void {
    if (this.currentGeometry === geometry) return;
    this.currentGeometry = geometry;

    this.solidMesh.geometry = geometry;
    this.outlineFill.geometry = geometry;

    this.edgesGeometry?.dispose();
    this.edgesGeometry = new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD_DEGREES);
    this.outlineEdges.geometry = this.edgesGeometry;
  }

  /**
   * `wireframe` forces the outline treatment even when `valid` — see the class doc.
   * Defaults to false so a fresh chest placement is unaffected.
   */
  show(geometry: THREE.BufferGeometry, transform: Mat4, valid: boolean, wireframe = false): void {
    this.rebuildEdgesIfNeeded(geometry);

    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.fromArray(transform as unknown as number[]);

    if (valid !== this.valid || wireframe !== this.wireframe) {
      this.valid = valid;
      this.wireframe = wireframe;
      this.applyTheme();
      this.applyVisibility();
    }
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.unwatchTheme();
    this.solidMaterial.dispose();
    this.outlineFillMaterial.dispose();
    this.outlineEdgesMaterial.dispose();
    this.edgesGeometry?.dispose();
  }
}
