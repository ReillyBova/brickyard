import { FlameIcon, LayoutGridIcon } from '../icons';
import { useTooltip } from '../tooltip';

export type SortMode = 'category' | 'popular';

interface SortToggleProps {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}

/**
 * Category order vs. most-used-first — the chest's other axis of organisation, next to
 * search and the category filter (`CategoryMenu`). Combines with both rather than
 * replacing them: this only changes how `PartsChest` orders whatever `filtered` already
 * contains.
 *
 * `.by-seg`, icon-only like the toolbar's Build/Render switch (`ToolbarModeSwitchView`)
 * — two options, no room for a visible label at this width, so each carries its own
 * tooltip via `useTooltip` instead. The accessible name lives on the button regardless,
 * per docs/DESIGN.md: "the tooltip is not the name".
 */
export function SortToggle({ value, onChange }: SortToggleProps) {
  const categoryTip = useTooltip({
    id: 'chest-sort-category',
    label: 'Group by category',
    groupId: 'chest-sort',
  });
  const popularTip = useTooltip({
    id: 'chest-sort-popular',
    label: 'Sort by popularity',
    groupId: 'chest-sort',
  });

  return (
    <div className="by-seg" role="group" aria-label="Sort parts">
      <button
        type="button"
        className={`by-seg__opt${value === 'category' ? ' is-active' : ''}`}
        aria-label="Group by category"
        aria-pressed={value === 'category'}
        onClick={() => onChange('category')}
        {...categoryTip}
      >
        <LayoutGridIcon />
      </button>
      <button
        type="button"
        className={`by-seg__opt${value === 'popular' ? ' is-active' : ''}`}
        aria-label="Sort by popularity"
        aria-pressed={value === 'popular'}
        onClick={() => onChange('popular')}
        {...popularTip}
      >
        <FlameIcon />
      </button>
    </div>
  );
}
