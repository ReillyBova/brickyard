import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ColorPicker } from '../ColorPicker/ColorPicker';
import { LDRAW_PALETTE } from '../ColorPicker/palette';
import { PartsChest } from '../PartsChest/PartsChest';
import { MOCK_PARTS } from '../PartsChest/mockParts';
import { AppShell } from './AppShell';

/** LDraw 4 — classic brick red — matching the App.tsx composition root's default. */
const DEFAULT_COLOR_CODE = 4;

/** The chest and colour panels wired to local state, exactly as a consuming screen would. */
function Demo() {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [selectedCode, setSelectedCode] = useState<number>(DEFAULT_COLOR_CODE);
  const activeColor = LDRAW_PALETTE.find((color) => color.code === selectedCode) ?? LDRAW_PALETTE[0];
  return (
    <AppShell
      chestPanel={
        <PartsChest
          parts={MOCK_PARTS}
          selectedId={selectedId}
          onSelect={setSelectedId}
          activeColorHex={activeColor.hex}
        />
      }
      colorPanel={<ColorPicker colors={LDRAW_PALETTE} selectedCode={selectedCode} onSelect={setSelectedCode} />}
    />
  );
}

/**
 * `AppShell.css`'s rail collapse is a real `@media (max-width: 860px)` query, which
 * evaluates against the document's own viewport — not the size of some wrapper div
 * inside it. So these stories drive Storybook's viewport tool (which actually resizes
 * the preview iframe) rather than nesting `AppShell` in a fixed-width container, which
 * would never trigger the breakpoint at all.
 */
const BREAKPOINT_VIEWPORTS = {
  desktop: { name: 'Desktop (1200px)', styles: { width: '1200px', height: '760px' }, type: 'desktop' as const },
  justAbove: { name: 'Just above 860px breakpoint (900px)', styles: { width: '900px', height: '760px' }, type: 'desktop' as const },
  justBelow: { name: 'Just below 860px breakpoint (820px)', styles: { width: '820px', height: '760px' }, type: 'desktop' as const },
  phone: { name: 'Phone (375px)', styles: { width: '375px', height: '812px' }, type: 'mobile' as const },
};

const meta = {
  title: 'AppShell',
  component: AppShell,
  args: { chestPanel: null, colorPanel: null },
  parameters: {
    layout: 'fullscreen',
    viewport: { options: BREAKPOINT_VIEWPORTS },
  },
  render: () => <Demo />,
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Desktop width (1200px, well above the 860px breakpoint): both rails hold their grid
 * columns as floating panels with a gutter to the frame edge, and the compact top bar
 * is hidden.
 */
export const Desktop: Story = {
  globals: { viewport: { value: 'desktop' } },
};

/**
 * The last width where both rails still hold their grid columns (900px). Compare
 * against `JustBelowBreakpoint` to see the exact point the layout flips — the agent that
 * built `AppShell` called the 860px cutoff its own judgement call, not something
 * `docs/DESIGN.md` prescribes.
 */
export const JustAboveBreakpoint: Story = {
  name: 'Just above breakpoint (900px)',
  globals: { viewport: { value: 'justAbove' } },
};

/**
 * Just below the breakpoint (820px): rails collapse to on-demand overlays behind the
 * compact top bar's Chest/Colour toggle, and the viewport keeps full width underneath.
 */
export const JustBelowBreakpoint: Story = {
  name: 'Just below breakpoint (820px)',
  globals: { viewport: { value: 'justBelow' } },
};

/** A phone-width frame (375px) with both rails closed — the empty-baseplate state underneath. */
export const NarrowClosed: Story = {
  name: 'Narrow, rails closed (375px)',
  globals: { viewport: { value: 'phone' } },
};

/** The same phone-width frame with the Chest rail opened as an overlay via the top bar. */
export const NarrowChestOpen: Story = {
  name: 'Narrow, chest rail open (375px)',
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>('.by-seg__opt');
    button?.click();
  },
};
