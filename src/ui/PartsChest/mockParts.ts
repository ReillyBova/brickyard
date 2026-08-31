import type { ChestPart } from './types';

/**
 * A representative slice of the chest, using real LDraw part numbers and titles.
 * Fetches nothing — the baked catalog wires into the real thing later.
 */
export const MOCK_PARTS: readonly ChestPart[] = [
  { id: '3001', title: 'Brick 2 x 4', category: 'Bricks' },
  { id: '3003', title: 'Brick 2 x 2', category: 'Bricks' },
  { id: '3004', title: 'Brick 1 x 2', category: 'Bricks' },
  { id: '3005', title: 'Brick 1 x 1', category: 'Bricks' },
  { id: '3010', title: 'Brick 1 x 4', category: 'Bricks' },
  { id: '2456', title: 'Brick 2 x 6', category: 'Bricks' },

  { id: '3020', title: 'Plate 2 x 4', category: 'Plates' },
  { id: '3022', title: 'Plate 2 x 2', category: 'Plates' },
  { id: '3023', title: 'Plate 1 x 2', category: 'Plates' },
  { id: '3024', title: 'Plate 1 x 1', category: 'Plates' },
  { id: '3031', title: 'Plate 4 x 4', category: 'Plates' },

  { id: '3068b', title: 'Tile 2 x 2', category: 'Tiles' },
  { id: '3069b', title: 'Tile 1 x 2', category: 'Tiles' },
  { id: '4162', title: 'Tile 1 x 8', category: 'Tiles' },

  { id: '3037', title: 'Slope Brick 45 2 x 4', category: 'Slopes' },
  { id: '3040', title: 'Slope Brick 45 2 x 1', category: 'Slopes' },
  { id: '3665', title: 'Slope Brick 45 2 x 1 Inverted', category: 'Slopes' },

  { id: '3700', title: 'Technic Brick 1 x 2 with Hole', category: 'Technic' },
  { id: '3701', title: 'Technic Brick 1 x 4 with Holes', category: 'Technic' },
  { id: '3673', title: 'Technic Pin', category: 'Technic' },
  { id: '32523', title: 'Technic Liftarm 1 x 5', category: 'Technic' },

  { id: '973', title: 'Minifig Torso', category: 'Minifigure' },
  { id: '3626', title: 'Minifig Head', category: 'Minifigure' },
  { id: '3818', title: 'Minifig Arm Right', category: 'Minifigure' },
  { id: '3815', title: 'Minifig Leg Right', category: 'Minifigure' },

  { id: '4073', title: 'Plate 1 x 1 Round', category: 'Round' },
  { id: '3062b', title: 'Brick 1 x 1 Round', category: 'Round' },
];
