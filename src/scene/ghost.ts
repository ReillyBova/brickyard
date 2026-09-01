/**
 * Ghost preview: a translucent render of a part at a candidate transform, with a
 * valid/invalid visual state. This is mechanism only — imperative show/hide — not
 * behaviour. When it appears, where it moves, and how the part and transform are
 * chosen are the interaction layer's business.
 *
 * Valid and invalid are rendered differently, not just recoloured:
 *
 * - Valid: the solid mesh from `docs/DESIGN.md` ("Ghost: solid geometry, no
 *   wireframe"), depth-tested normally. It never overlaps placed geometry, so ordinary
 *   depth testing never fights.
 * - Invalid: a collision by definition overlaps placed geometry, so the same solid mesh
 *   would z-fight it — coplanar and crossing faces flicker as the depth buffer can't
 *   consistently resolve which surface is "in front". Polygon offset only fixes a
 *   coplanar *seam*; a piece genuinely sunk into another crosses the depth buffer
 *   repeatedly through the whole overlap volume, which offset does nothing for. So the
 *   invalid state switches to `depthTest: false` — there is nothing left to fight
 *   because it stops comparing depth at all, and drawn on top of everything it reads
 *   correctly as an overlay: a proposal, not real geometry. It also renders as edges
 *   (`THREE.EdgesGeometry`, hard silhouette lines only — not `WireframeGeometry`, which
 *   draws every triangulation diagonal across flat faces and looks like a debug view)
 *   plus a faint fill, both in `--by-3d-invalid`, so the shape still reads as a shape.
 */

import * as THREE from 'three';

import type { Mat4 } from '../types';

import { readColorToken, readNumberToken, watchTheme } from './theme.ts';

/** Hard silhouette edges only — coplanar faces don't get an interior diagonal drawn. */
const EDGE_THRESHOLD_DEGREES = 15;

export class GhostPreview {
  /** Group so valid (solid) and invalid (edges + fill) can coexist and swap visibility. */
  readonly mesh: THREE.Group;

  private readonly solidMesh: THREE.Mesh;
  private readonly solidMaterial: THREE.MeshStandardMaterial;

  private readonly invalidFill: THREE.Mesh;
  private readonly invalidFillMaterial: THREE.MeshBasicMaterial;
  private readonly invalidEdges: THREE.LineSegments;
  private readonly invalidEdgesMaterial: THREE.LineBasicMaterial;

  private currentGeometry: THREE.BufferGeometry | null = null;
  private edgesGeometry: THREE.BufferGeometry | null = null;
  private valid = true;
  private readonly unwatchTheme: () => void;

  constructor() {
    this.solidMaterial = new THREE.MeshStandardMaterial({
      transparent: true,
      depthWrite: false,
    });
    this.solidMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.solidMaterial);
    this.solidMesh.raycast = () => {};

    this.invalidFillMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.invalidFill = new THREE.Mesh(new THREE.BufferGeometry(), this.invalidFillMaterial);
    this.invalidFill.raycast = () => {};
    // Draws after the solid batches regardless of submission order.
    this.invalidFill.renderOrder = 10;

    this.invalidEdgesMaterial = new THREE.LineBasicMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.invalidEdges = new THREE.LineSegments(new THREE.BufferGeometry(), this.invalidEdgesMaterial);
    this.invalidEdges.raycast = () => {};
    this.invalidEdges.renderOrder = 11;

    this.mesh = new THREE.Group();
    this.mesh.add(this.solidMesh, this.invalidFill, this.invalidEdges);
    this.mesh.visible = false;
    this.setValid(true);

    this.applyTheme();
    this.unwatchTheme = watchTheme(() => this.applyTheme());
  }

  private applyTheme(): void {
    const ghostAlpha = readNumberToken('--by-3d-ghost-alpha', 0.45);
    const invalidAlpha = readNumberToken('--by-3d-invalid-alpha', 0.18);
    const ghostColor = readColorToken('--by-3d-ghost', '#4caf50');
    const invalidColor = readColorToken('--by-3d-invalid', '#e53935');

    this.solidMaterial.opacity = ghostAlpha;
    this.solidMaterial.color.copy(ghostColor);

    this.invalidFillMaterial.opacity = invalidAlpha;
    this.invalidFillMaterial.color.copy(invalidColor);
    this.invalidEdgesMaterial.color.copy(invalidColor);
  }

  private setValid(valid: boolean): void {
    this.valid = valid;
    this.solidMesh.visible = valid;
    this.invalidFill.visible = !valid;
    this.invalidEdges.visible = !valid;
  }

  private rebuildEdgesIfNeeded(geometry: THREE.BufferGeometry): void {
    if (this.currentGeometry === geometry) return;
    this.currentGeometry = geometry;

    this.solidMesh.geometry = geometry;
    this.invalidFill.geometry = geometry;

    this.edgesGeometry?.dispose();
    this.edgesGeometry = new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD_DEGREES);
    this.invalidEdges.geometry = this.edgesGeometry;
  }

  show(geometry: THREE.BufferGeometry, transform: Mat4, valid: boolean): void {
    this.rebuildEdgesIfNeeded(geometry);

    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.fromArray(transform as unknown as number[]);

    if (valid !== this.valid) this.setValid(valid);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.unwatchTheme();
    this.solidMaterial.dispose();
    this.invalidFillMaterial.dispose();
    this.invalidEdgesMaterial.dispose();
    this.edgesGeometry?.dispose();
  }
}
