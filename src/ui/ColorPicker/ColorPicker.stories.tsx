import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ColorPicker } from './ColorPicker';
import { LDRAW_PALETTE } from './palette';
import type { Swatch } from './types';

const FINISH_MATERIALS: ReadonlySet<Swatch['material']> = new Set([
  'transparent',
  'pearlescent',
  'chrome',
  'metallic',
  'glitter',
  'speckle',
  'fabric',
]);

function Rail({ children }: { children: ReactNode }) {
  return (
    <div style={{ width: 'var(--by-panel-w)', height: '640px', display: 'flex' }}>{children}</div>
  );
}

function Controlled({ colors, initialSelectedCode }: { colors: readonly Swatch[]; initialSelectedCode?: number }) {
  const [selectedCode, setSelectedCode] = useState<number | undefined>(initialSelectedCode);
  return <ColorPicker colors={colors} selectedCode={selectedCode} onSelect={setSelectedCode} />;
}

const meta = {
  title: 'ColorPicker',
  component: ColorPicker,
  args: {
    colors: LDRAW_PALETTE,
    onSelect: () => {},
  },
} satisfies Meta<typeof ColorPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The full real LDraw palette — every colour in `LDConfig.ldr` spanning all 9
 * `MaterialClass` values,
 * grouped under `.by-eyebrow` headings (solid, transparent, pearlescent, chrome,
 * metallic, rubber, glitter, speckle, fabric). Swatches render the real LDraw RGB
 * unmodified, per docs/DESIGN.md's "the palette is data" rule — several clash with
 * both themes on purpose. Flip the theme toolbar to check both.
 */
export const FullPalette: Story = {
  decorators: [(Story) => <Rail><Story /></Rail>],
};

/**
 * A swatch selected — the ring is drawn in the theme accent *outside* the swatch
 * (`.is-selected`), never as a tint on the LDraw colour itself. Selected here is
 * Trans-Red (code 36), which is both a transparent finish and a colour that clashes
 * with the terracotta accent, to stress-test that the ring never blends into the fill.
 */
export const SwatchSelected: Story = {
  decorators: [(Story) => <Rail><Story /></Rail>],
  render: (args) => <Controlled colors={args.colors} initialSelectedCode={36} />,
};

/**
 * Every finish marker BrickYard draws: the diagonal `.by-swatch--trans` hatch
 * (transparent, glitter) and the sheen `.by-swatch--metal` highlight (chrome,
 * pearlescent, metallic). Rubber, speckle and fabric get no marker — the swatch
 * grouping under the `.by-eyebrow` heading is the only thing that calls out their
 * material class, which this story also makes checkable.
 */
export const FinishMarkers: Story = {
  name: 'Finish markers',
  args: {
    colors: LDRAW_PALETTE.filter((c) => FINISH_MATERIALS.has(c.material)),
  },
  decorators: [(Story) => <Rail><Story /></Rail>],
};
