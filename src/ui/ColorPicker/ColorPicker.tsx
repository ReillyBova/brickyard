import { useMemo } from 'react';

import { useRovingGrid } from '../useRovingGrid';
import type { Swatch } from './types';

interface ColorPickerProps {
  colors: readonly Swatch[];
  selectedCode?: number;
  onSelect: (code: number) => void;
}

const MATERIAL_LABEL: Record<Swatch['material'], string> = {
  solid: 'Solid',
  transparent: 'Transparent',
  chrome: 'Chrome',
  pearlescent: 'Pearlescent',
  metallic: 'Metallic',
  rubber: 'Rubber',
  glitter: 'Glitter',
  speckle: 'Speckle',
  fabric: 'Fabric',
};

/** Material order controls display order — solids first, novelty finishes last. */
const MATERIAL_ORDER: readonly Swatch['material'][] = [
  'solid',
  'transparent',
  'pearlescent',
  'chrome',
  'metallic',
  'rubber',
  'glitter',
  'speckle',
  'fabric',
];

interface Group {
  material: Swatch['material'];
  colors: Swatch[];
}

function groupByMaterial(colors: readonly Swatch[]): Group[] {
  const byMaterial = new Map<Swatch['material'], Swatch[]>();
  for (const color of colors) {
    const bucket = byMaterial.get(color.material);
    if (bucket === undefined) byMaterial.set(color.material, [color]);
    else bucket.push(color);
  }
  return MATERIAL_ORDER.filter((material) => byMaterial.has(material)).map((material) => ({
    material,
    colors: byMaterial.get(material)!,
  }));
}

/**
 * The LDraw colour picker. Swatches carry the real LDraw RGB as data — per
 * docs/DESIGN.md the palette is not reinterpreted, so a swatch can be any colour at
 * all. Material class is made legible by grouping under a heading, not by tinting the
 * swatch; the selected state is the theme-accent ring drawn outside the swatch
 * (`.by-swatch.is-selected`), and finish is a marker (`--trans`, `--metal`) rather than
 * a colour change.
 */
export function ColorPicker({ colors, selectedCode, onSelect }: ColorPickerProps) {
  const groups = useMemo(() => groupByMaterial(colors), [colors]);
  const { containerRef, onKeyDown } = useRovingGrid(colors.length);

  const flatIndexByCode = useMemo(() => {
    const map = new Map<number, number>();
    let i = 0;
    for (const group of groups) for (const color of group.colors) map.set(color.code, i++);
    return map;
  }, [groups]);

  return (
    <div className="by-panel">
      <div className="by-panel__head">
        <div className="by-panel__title">Colour</div>
      </div>
      <div className="by-panel__body" ref={containerRef}>
        {groups.map((group, groupIndex) => (
          <div key={group.material}>
            <div
              className="by-eyebrow"
              style={{
                marginBottom: 'var(--by-space-2)',
                marginTop: groupIndex === 0 ? 0 : 'var(--by-space-4)',
              }}
            >
              {MATERIAL_LABEL[group.material]}
            </div>
            <div className="by-swatch-grid" aria-label={MATERIAL_LABEL[group.material]}>
              {group.colors.map((color) => {
                const index = flatIndexByCode.get(color.code)!;
                const isSelected = color.code === selectedCode;
                const finish =
                  color.material === 'transparent' || color.material === 'glitter'
                    ? ' by-swatch--trans'
                    : color.material === 'chrome' ||
                        color.material === 'pearlescent' ||
                        color.material === 'metallic'
                      ? ' by-swatch--metal'
                      : '';
                return (
                  <button
                    key={color.code}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${color.name}, LDraw colour ${color.code}, ${MATERIAL_LABEL[color.material]}`}
                    title={`${color.name} · ${color.code}`}
                    className={`by-swatch${finish}${isSelected ? ' is-selected' : ''}`}
                    style={{ background: color.hex }}
                    data-index={index}
                    onClick={() => onSelect(color.code)}
                    onKeyDown={(event) => onKeyDown(event, index)}
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
