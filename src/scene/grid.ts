/**
 * Baseplate grid, for spatial reference. Purely decorative: not a pick target, not a
 * baseplate part.
 */

import * as THREE from 'three';

import { readColorToken, watchTheme } from './theme.ts';

const STUD_PITCH = 20;
const GRID_OPACITY = 0.5;

function applyGridColor(grid: THREE.GridHelper): void {
  const color = readColorToken('--by-canvas-grid', '#888888');
  const attr = grid.geometry.getAttribute('color') as THREE.BufferAttribute;
  const array = attr.array as Float32Array;
  for (let i = 0; i < array.length; i += 3) {
    array[i] = color.r;
    array[i + 1] = color.g;
    array[i + 2] = color.b;
  }
  attr.needsUpdate = true;
}

/**
 * A grid at LDU `y = 0`, `studsPerSide` studs wide, one line per stud. Sits as a child
 * of the scene root, so it inherits the LDraw -> three flip like everything else.
 *
 * Colour is read from `--by-canvas-grid` and re-applied whenever `data-theme` changes
 * on `<html>`; call `stopWatchingTheme()` (attached to the returned object) to release
 * that subscription when the grid is torn down.
 */
export function createBaseplateGrid(studsPerSide = 48): THREE.GridHelper {
  const size = studsPerSide * STUD_PITCH;
  const grid = new THREE.GridHelper(size, studsPerSide, 0xffffff, 0xffffff);
  grid.name = 'baseplate-grid';
  grid.position.set(0, 0, 0);
  grid.raycast = () => {};
  const material = grid.material as THREE.Material | THREE.Material[];
  for (const m of Array.isArray(material) ? material : [material]) {
    m.transparent = true;
    m.opacity = GRID_OPACITY;
  }

  applyGridColor(grid);
  const unwatch = watchTheme(() => applyGridColor(grid));

  const dispose = grid.dispose.bind(grid);
  grid.dispose = () => {
    unwatch();
    dispose();
  };

  return grid;
}
