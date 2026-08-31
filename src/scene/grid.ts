/**
 * Baseplate grid, for spatial reference. Purely decorative: not a pick target, not a
 * baseplate part.
 */

import * as THREE from 'three';

const STUD_PITCH = 20;

/**
 * A grid at LDU `y = 0`, `studsPerSide` studs wide, one line per stud. Sits as a child
 * of the scene root, so it inherits the LDraw -> three flip like everything else.
 */
export function createBaseplateGrid(studsPerSide = 48): THREE.GridHelper {
  const size = studsPerSide * STUD_PITCH;
  const grid = new THREE.GridHelper(size, studsPerSide, 0x888888, 0x444444);
  grid.name = 'baseplate-grid';
  grid.position.set(0, 0, 0);
  grid.raycast = () => {};
  const material = grid.material as THREE.Material | THREE.Material[];
  for (const m of Array.isArray(material) ? material : [material]) {
    m.transparent = true;
    m.opacity = 0.5;
  }
  return grid;
}
