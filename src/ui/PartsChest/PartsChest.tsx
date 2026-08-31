import { useMemo, useState } from 'react';

import { AxonBrick } from '../AxonBrick';
import { studsForTitle, toneForId } from '../brickPictogram';
import { SearchIcon } from '../icons';
import { useRovingGrid } from '../useRovingGrid';
import type { ChestPart } from './types';

interface PartsChestProps {
  parts: readonly ChestPart[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

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
export function PartsChest({ parts, selectedId, onSelect }: PartsChestProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return parts;
    return parts.filter(
      (part) => part.title.toLowerCase().includes(q) || part.id.toLowerCase().includes(q),
    );
  }, [parts, query]);

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
        <div className="by-panel__title">Chest</div>
      </div>
      <div style={{ padding: '0 var(--by-space-3) var(--by-space-2)' }}>
        <div className="by-search">
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
      </div>
      <div className="by-panel__body" ref={containerRef}>
        {groups.length === 0 && (
          <div className="by-empty">
            <p className="by-empty__title">No matches</p>
            <p className="by-empty__body">
              Nothing found for &ldquo;{query}&rdquo;. Try a part number or a different word.
            </p>
            <button type="button" className="by-btn by-btn--secondary by-btn--sm" onClick={() => setQuery('')}>
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
                const isSelected = part.id === selectedId;
                return (
                  <button
                    key={part.id}
                    type="button"
                    aria-pressed={isSelected}
                    className={`by-tile${isSelected ? ' is-selected' : ''}`}
                    data-index={index}
                    title={part.title}
                    onClick={() => onSelect(part.id)}
                    onKeyDown={(event) => onKeyDown(event, index)}
                  >
                    <span className="by-tile__thumb">
                      <AxonBrick
                        tone={toneForId(part.id)}
                        studs={studsForTitle(part.title)}
                        round={group.category === 'Round'}
                      />
                    </span>
                    <span className="by-tile__label">{part.id}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
