import type { Swatch } from './types';

/**
 * A representative slice of LDConfig.ldr's 322 colours, spanning every material class.
 * Codes, names, and hex values are drawn from the real palette; this is a subset for
 * building and testing the picker, not the baked catalog.
 */
export const MOCK_COLORS: readonly Swatch[] = [
  // Solid
  { code: 0, name: 'Black', hex: '#05131d', edgeHex: '#000000', material: 'solid' },
  { code: 1, name: 'Blue', hex: '#0055bf', edgeHex: '#00397e', material: 'solid' },
  { code: 2, name: 'Green', hex: '#237841', edgeHex: '#00542c', material: 'solid' },
  { code: 4, name: 'Red', hex: '#c91a09', edgeHex: '#8a0f04', material: 'solid' },
  { code: 14, name: 'Yellow', hex: '#f2cd37', edgeHex: '#a89628', material: 'solid' },
  { code: 15, name: 'White', hex: '#ffffff', edgeHex: '#c9c9c9', material: 'solid' },
  { code: 71, name: 'Light Bluish Gray', hex: '#a0a5a9', edgeHex: '#6c6e68', material: 'solid' },
  { code: 72, name: 'Dark Bluish Gray', hex: '#6c6e68', edgeHex: '#3c3c3c', material: 'solid' },

  // Transparent
  { code: 47, name: 'Trans-Clear', hex: '#fcfcfc', edgeHex: '#dcdcdc', material: 'transparent', alpha: 0.25 },
  { code: 36, name: 'Trans-Red', hex: '#c91a09', edgeHex: '#8a0f04', material: 'transparent', alpha: 0.45 },
  { code: 43, name: 'Trans-Light Blue', hex: '#aee9ef', edgeHex: '#68b5c4', material: 'transparent', alpha: 0.5 },
  { code: 46, name: 'Trans-Yellow', hex: '#f5cd2f', edgeHex: '#a89628', material: 'transparent', alpha: 0.45 },

  // Chrome
  { code: 61, name: 'Chrome Blue', hex: '#6c96bf', edgeHex: '#3c5c80', material: 'chrome' },
  { code: 64, name: 'Chrome Silver', hex: '#e0e0e0', edgeHex: '#a0a0a0', material: 'chrome' },

  // Pearlescent
  { code: 183, name: 'Pearl White', hex: '#f2f3f2', edgeHex: '#c0c0c0', material: 'pearlescent' },
  { code: 297, name: 'Pearl Gold', hex: '#aa7f2e', edgeHex: '#7a5a1e', material: 'pearlescent' },

  // Metallic
  { code: 131, name: 'Metallic Silver', hex: '#a5a9b4', edgeHex: '#6c6e68', material: 'metallic' },
  { code: 176, name: 'Metallic Copper', hex: '#ae7a59', edgeHex: '#7a5238', material: 'metallic' },

  // Rubber
  { code: 256, name: 'Rubber Black', hex: '#05131d', edgeHex: '#000000', material: 'rubber' },
  { code: 273, name: 'Rubber Blue', hex: '#0055bf', edgeHex: '#00397e', material: 'rubber' },

  // Glitter
  { code: 114, name: 'Glitter Trans-Pink', hex: '#df6695', edgeHex: '#a03c68', material: 'glitter', alpha: 0.5 },
  { code: 129, name: 'Glitter Trans-Purple', hex: '#8320b7', edgeHex: '#551680', material: 'glitter', alpha: 0.5 },

  // Speckle
  { code: 149, name: 'Speckle Black-Silver', hex: '#08101a', edgeHex: '#000000', material: 'speckle' },
  { code: 111, name: 'Speckle Black-Gold', hex: '#08101a', edgeHex: '#000000', material: 'speckle' },

  // Fabric
  { code: 320, name: 'Fabric Red', hex: '#8b1a2b', edgeHex: '#5c1120', material: 'fabric' },
  { code: 321, name: 'Fabric Black', hex: '#1b1b1b', edgeHex: '#000000', material: 'fabric' },
];
