import type { Meta, StoryObj } from '@storybook/react-vite';

import { AxonBrick } from './AxonBrick';
import { LDRAW_PALETTE } from './ColorPicker/palette';

/**
 * The chest tile's thumbnail pictogram in isolation, across a spread of real LDraw
 * colours and stud counts — worth its own story since `PartsChest.stories.tsx` only
 * shows it embedded inside real tiles, at whatever colour happens to be active.
 */
const meta = {
  title: 'PartsChest/AxonBrick',
  component: AxonBrick,
  // Overridden by the one story's own `render`; this only satisfies the required props.
  args: { hex: LDRAW_PALETTE[0].hex, studs: 1 },
} satisfies Meta<typeof AxonBrick>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A representative spread of real LDraw colours, by name, falling back to the first
 * palette entry if a name isn't present in the fixture's slice of LDConfig. */
const SAMPLE_NAMES = ['Red', 'Blue', 'Yellow', 'Black', 'Trans Light Blue'] as const;
const SAMPLES = SAMPLE_NAMES.map(
  (name) => LDRAW_PALETTE.find((color) => color.name === name) ?? LDRAW_PALETTE[0],
);

function Grid() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--by-space-4)' }}>
      {SAMPLES.map((color) => (
        <div key={color.code} style={{ display: 'flex', alignItems: 'center', gap: 'var(--by-space-4)' }}>
          <span
            style={{
              width: 100,
              fontFamily: 'var(--by-font-mono)',
              fontSize: 'var(--by-text-xs)',
              color: 'var(--by-text-faint)',
            }}
          >
            {color.name}
          </span>
          {([1, 2, 4] as const).map((studs) => (
            <div key={studs} className="by-tile__thumb" style={{ width: 52, height: 52 }}>
              <AxonBrick hex={color.hex} studs={studs} />
            </div>
          ))}
          <div className="by-tile__thumb" style={{ width: 52, height: 52 }}>
            <AxonBrick hex={color.hex} studs={1} round />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A spread of real LDraw colours at 1/2/4 studs, plus the round variant. */
export const AllColorsAndStuds: Story = {
  render: () => <Grid />,
};
