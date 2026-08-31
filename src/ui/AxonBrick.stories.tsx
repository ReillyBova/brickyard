import type { Meta, StoryObj } from '@storybook/react-vite';

import { AxonBrick } from './AxonBrick';
import type { BrickTone } from './brickPictogram';

/**
 * The chest tile's thumbnail pictogram in isolation, across every `BrickTone` and stud
 * count it's used with — worth its own story since `PartsChest.stories.tsx` only shows
 * it embedded inside real tiles, at whatever tone/stud count the mock data happens to
 * hash to.
 */
const meta = {
  title: 'PartsChest/AxonBrick',
  component: AxonBrick,
  // Overridden by the one story's own `render`; this only satisfies the required props.
  args: { tone: 'clay', studs: 1 },
} satisfies Meta<typeof AxonBrick>;

export default meta;
type Story = StoryObj<typeof meta>;

const TONES: readonly BrickTone[] = ['clay', 'deepClay', 'sage', 'neutral'];

function Grid() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--by-space-4)' }}>
      {TONES.map((tone) => (
        <div key={tone} style={{ display: 'flex', alignItems: 'center', gap: 'var(--by-space-4)' }}>
          <span
            style={{
              width: 80,
              fontFamily: 'var(--by-font-mono)',
              fontSize: 'var(--by-text-xs)',
              color: 'var(--by-text-faint)',
            }}
          >
            {tone}
          </span>
          {([1, 2, 4] as const).map((studs) => (
            <div key={studs} className="by-tile__thumb" style={{ width: 52, height: 52 }}>
              <AxonBrick tone={tone} studs={studs} />
            </div>
          ))}
          <div className="by-tile__thumb" style={{ width: 52, height: 52 }}>
            <AxonBrick tone={tone} studs={1} round />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Every tone (clay, deepClay, sage, neutral) at 1/2/4 studs, plus the round variant. */
export const AllTonesAndStuds: Story = {
  render: () => <Grid />,
};
