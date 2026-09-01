import { useMemo, useState } from 'react';

import { SearchIcon } from '../icons';
import { useTooltipDelegate } from '../tooltip';
import { useRovingGrid } from '../useRovingGrid';
import { CategoryMenu } from './CategoryMenu';
import { PartTile } from './PartTile';
import { SortToggle, type SortMode } from './SortToggle';
import type { ThumbnailSource } from '../../scene/thumbnail';
import type { ChestPart } from './types';

interface PartsChestProps {
  parts: readonly ChestPart[];
  selectedId?: string;
  onSelect: (id: string) => void;
  /** '#rrggbb' — the color currently active for placement. Every thumbnail renders in
   * it, so the chest previews what the next click actually places. */
  activeColorHex: string;
  /**
   * Renders each tile's real thumbnail (`RuntimeThumbnailRenderer` from
   * `src/scene/thumbnail.ts`) in the composition root. Left `undefined` in Storybook and
   * component tests, where every tile falls back to the `AxonBrick` pictogram instead of
   * standing up a WebGL context per story.
   */
  thumbnailSource?: ThumbnailSource;
}

const ALL_CATEGORIES = 'All categories';

/** Chest categories, most-reached-for first. See `categories` below. */
const CATEGORY_ORDER = [
  'Bricks',
  'Plates',
  'Tiles',
  'Slopes',
  'Wedges',
  'Arches',
  'Round',
  'SNOT',
  'Hinges',
  'Connectors',
  'Technic',
  'Wheels',
  'Windows & Doors',
  'Plants',
  'Minifigure',
];

/** Rank for `CATEGORY_ORDER`; anything unlisted sorts alphabetically after it. */
const CATEGORY_RANK = new Map(CATEGORY_ORDER.map((name, i) => [name, i]));

function byCategoryOrder(a: string, b: string): number {
  const ra = CATEGORY_RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
  const rb = CATEGORY_RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
  return ra === rb ? a.localeCompare(b) : ra - rb;
}

interface Group {
  /** `null` renders no `.by-eyebrow` header — the flat popularity ordering. */
  category: string | null;
  parts: ChestPart[];
}

function groupByCategory(parts: readonly ChestPart[]): Group[] {
  const byCategory = new Map<string, ChestPart[]>();
  for (const part of parts) {
    const bucket = byCategory.get(part.category);
    if (bucket === undefined) byCategory.set(part.category, [part]);
    else bucket.push(part);
  }
  // Sorted, not insertion-ordered: the Map follows catalog order, which is not the
  // order a builder wants to read. Same ranking the filter list uses.
  return Array.from(byCategory, ([category, group]) => ({ category, parts: group })).sort((a, b) =>
    byCategoryOrder(a.category, b.category ?? ''),
  );
}

/** Most-used first, per `usageCount` — see `SortToggle`. Ties (including the `undefined`
 * mock/test-data case, which sorts as 0) break on title so the order stays stable. One
 * ungrouped list: popularity is a ranking across the whole chest, not per category. */
function sortByPopularity(parts: readonly ChestPart[]): Group[] {
  if (parts.length === 0) return [];
  const sorted = [...parts].sort(
    (a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.title.localeCompare(b.title),
  );
  return [{ category: null, parts: sorted }];
}

/**
 * A browsable, searchable panel over `parts`. Takes the list as a prop and fetches
 * nothing — the baked catalog wires in later. Tiles are grouped by category, each in
 * one flat keyboard-navigable grid (arrow keys, Home/End) per docs/DESIGN.md's
 * `.by-tile-grid` / `.by-tile`.
 */
export function PartsChest({
  parts,
  selectedId,
  onSelect,
  activeColorHex,
  thumbnailSource,
}: PartsChestProps) {
  const [query, setQuery] = useState('');
  /** `undefined` means no category filter — "All categories". */
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [sortMode, setSortMode] = useState<SortMode>('category');

  const categories = useMemo(() => {
    const present = new Set(parts.map((part) => part.category));
    // Ordered by how often a builder reaches for them, not alphabetically — bricks and
    // plates are most of any model, minifigure and decorative parts are the long tail.
    // Anything not listed sorts alphabetically after these.
    return Array.from(present).sort(byCategoryOrder);
  }, [parts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parts.filter((part) => {
      if (category !== undefined && part.category !== category) return false;
      if (q === '') return true;
      return part.title.toLowerCase().includes(q) || part.id.toLowerCase().includes(q);
    });
  }, [parts, query, category]);

  const groups = useMemo(
    () => (sortMode === 'popular' ? sortByPopularity(filtered) : groupByCategory(filtered)),
    [filtered, sortMode],
  );
  const { containerRef, onKeyDown } = useRovingGrid(filtered.length);
  // One delegated listener for the whole chest rather than a tooltip hook per tile — the
  // catalog runs into the hundreds of parts.
  useTooltipDelegate(containerRef, 'parts-chest');

  const flatIndexById = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const group of groups) for (const part of group.parts) map.set(part.id, i++);
    return map;
  }, [groups]);

  return (
    <div className="by-panel">
      <div className="by-panel__head">
        <div className="by-panel__title">Parts &amp; Pieces</div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--by-space-2)',
          padding: '0 var(--by-space-3) var(--by-space-2)',
        }}
      >
        <div className="by-search" style={{ flex: 1, minWidth: 0 }}>
          <SearchIcon width={15} height={15} />
          <input
            className="by-input"
            type="search"
            placeholder={`Search ${parts.length} parts`}
            aria-label="Search parts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SortToggle value={sortMode} onChange={setSortMode} />
        <CategoryMenu categories={categories} value={category} onChange={setCategory} allLabel={ALL_CATEGORIES} />
      </div>
      <div className="by-panel__body" ref={containerRef}>
        {groups.length === 0 && (
          <div className="by-empty">
            <p className="by-empty__title">No matches</p>
            <p className="by-empty__body">
              Nothing found for &ldquo;{query}&rdquo;. Try a part number or a different word.
            </p>
            <button
              type="button"
              className="by-btn by-btn--secondary by-btn--sm"
              onClick={() => {
                setQuery('');
                setCategory(undefined);
              }}
            >
              Clear search
            </button>
          </div>
        )}
        {groups.map((group, groupIndex) => (
          <div key={group.category ?? '__popular__'}>
            {group.category !== null && (
              <div
                className="by-eyebrow"
                style={{
                  marginBottom: 'var(--by-space-2)',
                  marginTop: groupIndex === 0 ? 0 : 'var(--by-space-4)',
                }}
              >
                {group.category}
              </div>
            )}
            <div className="by-tile-grid" aria-label={group.category ?? 'Parts by popularity'}>
              {group.parts.map((part) => {
                const index = flatIndexById.get(part.id)!;
                return (
                  <PartTile
                    key={part.id}
                    part={part}
                    index={index}
                    isSelected={part.id === selectedId}
                    isRound={part.category === 'Round'}
                    activeColorHex={activeColorHex}
                    thumbnailSource={thumbnailSource}
                    onSelect={onSelect}
                    onKeyDown={onKeyDown}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
