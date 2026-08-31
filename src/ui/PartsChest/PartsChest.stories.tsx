import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { LDRAW_PALETTE } from '../ColorPicker/palette';
import { PartsChest } from './PartsChest';
import { MOCK_PARTS } from './mockParts';

/** LDraw 4 — classic brick red — matching the App.tsx composition root's default. */
const ACTIVE_COLOR_HEX = (LDRAW_PALETTE.find((color) => color.code === 4) ?? LDRAW_PALETTE[0]).hex;

/**
 * The rail width and body height the chest gets inside `AppShell` (`--by-panel-w`, a
 * fixed height so `.by-panel__body`'s `overflow-y: auto` has a bound to work against).
 */
function Rail({ children, height = '600px' }: { children: ReactNode; height?: string }) {
  return (
    <div style={{ width: 'var(--by-panel-w)', height, display: 'flex' }}>{children}</div>
  );
}

/** `PartsChest` is fully controlled — this wraps it in local state for interactive stories. */
function Controlled({ initialSelectedId }: { initialSelectedId?: string }) {
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId);
  return (
    <PartsChest
      parts={MOCK_PARTS}
      selectedId={selectedId}
      onSelect={setSelectedId}
      activeColorHex={ACTIVE_COLOR_HEX}
    />
  );
}

const meta = {
  title: 'PartsChest',
  component: PartsChest,
  args: {
    parts: MOCK_PARTS,
    onSelect: () => {},
    activeColorHex: ACTIVE_COLOR_HEX,
  },
} satisfies Meta<typeof PartsChest>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full mock catalog — 27 parts across 6 categories, nothing selected. */
export const Populated: Story = {
  decorators: [(Story) => <Rail><Story /></Rail>],
};

/** A tile clicked to selected — the `.is-selected` accent ring, not a colour change. */
export const TileSelected: Story = {
  decorators: [(Story) => <Rail><Story /></Rail>],
  render: () => <Controlled initialSelectedId="3001" />,
};

/**
 * Typed into the chest's own search field ("technic" — 4 of the 27 mock parts match),
 * so the grouped, filtered result renders exactly as the running app would show it.
 */
export const FilteredBySearch: Story = {
  name: 'Filtered by search',
  decorators: [(Story) => <Rail><Story /></Rail>],
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByPlaceholderText(/Search \d+ parts/);
    await userEvent.type(input, 'technic');
  },
};

/** No parts match the query — `.by-empty` with a "Clear search" button. */
export const NoMatches: Story = {
  decorators: [(Story) => <Rail><Story /></Rail>],
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByPlaceholderText(/Search \d+ parts/);
    await userEvent.type(input, 'xyz-no-such-part');
  },
};

/**
 * The same 27-part catalog in a shorter rail, so the panel body actually has to scroll.
 * Compare against `Populated`, which is tall enough that nothing does.
 */
export const LongListScrolls: Story = {
  name: 'Long list scrolls',
  decorators: [(Story) => <Rail height="260px"><Story /></Rail>],
};
