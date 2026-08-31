import { useMemo, useState } from 'react';

import { SearchIcon } from '../icons';
import { useRovingGrid } from '../useRovingGrid';
import { CategoryMenu } from './CategoryMenu';
import { PartTile } from './PartTile';
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

interface Group {
  category: string;
  parts: ChestPart[];
}

function groupByCategory(parts: readonly ChestPart[]): Group[] {
  const byCategory = new Map<string, ChestPart[]>();
  for (const part of parts) {
    const bucket = byCategory.get(part.category);
    if (bucket === undefined) byCategory.set(part.category, [part]);
    else bucket.push(part);
  }
  return Array.from(byCategory, ([category, group]) => ({ category, parts: group }));
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

  const categories = useMemo(
    () => Array.from(new Set(parts.map((part) => part.category))).sort((a, b) => a.localeCompare(b)),
    [parts],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parts.filter((part) => {
      if (category !== undefined && part.category !== category) return false;
      if (q === '') return true;
      return part.title.toLowerCase().includes(q) || part.id.toLowerCase().includes(q);
    });
  }, [parts, query, category]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);
  const { containerRef, onKeyDown } = useRovingGrid(filtered.length);

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
          <div key={group.category}>
            <div
              className="by-eyebrow"
              style={{
                marginBottom: 'var(--by-space-2)',
                marginTop: groupIndex === 0 ? 0 : 'var(--by-space-4)',
              }}
            >
              {group.category}
            </div>
            <div className="by-tile-grid" aria-label={group.category}>
              {group.parts.map((part) => {
                const index = flatIndexById.get(part.id)!;
                return (
                  <PartTile
                    key={part.id}
                    part={part}
                    index={index}
                    isSelected={part.id === selectedId}
                    isRound={group.category === 'Round'}
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
