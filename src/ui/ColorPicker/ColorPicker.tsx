import { useMemo, useState } from 'react';

import { ChevronDownIcon } from '../icons';
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

/** Finish overlay class per material — a mark on top of the swatch, never a tint of it. */
const MATERIAL_MARK: Record<Swatch['material'], string> = {
  solid: '',
  transparent: 'by-swatch--trans',
  chrome: 'by-swatch--chrome',
  pearlescent: 'by-swatch--pearl',
  metallic: 'by-swatch--metallic',
  rubber: 'by-swatch--rubber',
  glitter: 'by-swatch--glitter',
  speckle: 'by-swatch--speckle',
  fabric: 'by-swatch--fabric',
};

/** Display order within the accordion — closest to solid first, novelty finishes last. */
const OTHER_MATERIAL_ORDER: readonly Swatch['material'][] = [
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

function groupByMaterial(colors: readonly Swatch[]): Map<Swatch['material'], Swatch[]> {
  const byMaterial = new Map<Swatch['material'], Swatch[]>();
  for (const color of colors) {
    const bucket = byMaterial.get(color.material);
    if (bucket === undefined) byMaterial.set(color.material, [color]);
    else bucket.push(color);
  }
  return byMaterial;
}

function Swatches({
  colors,
  selectedCode,
  indexOf,
  onSelect,
  onKeyDown,
}: {
  colors: readonly Swatch[];
  selectedCode: number | undefined;
  indexOf: Map<number, number>;
  onSelect: (code: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>, index: number) => void;
}) {
  return (
    <>
      {colors.map((color) => {
        // -1 when the accordion is closed and this swatch sits in a hidden group: the
        // browser makes closed <details> content unfocusable, so the roving grid never
        // actually reaches it, but the index still has to be a number to render.
        const index = indexOf.get(color.code) ?? -1;
        const isSelected = color.code === selectedCode;
        return (
          <button
            key={color.code}
            type="button"
            aria-pressed={isSelected}
            aria-label={`${color.name}, LDraw color ${color.code}, ${MATERIAL_LABEL[color.material]}`}
            title={`${color.name} · ${color.code}`}
            className={`by-swatch ${MATERIAL_MARK[color.material]}${isSelected ? ' is-selected' : ''}`}
            style={{ backgroundColor: color.hex, borderColor: color.edgeHex }}
            data-index={index}
            onClick={() => onSelect(color.code)}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
        );
      })}
    </>
  );
}

/**
 * The LDraw colour picker, styled as a palette rather than a settings list: a compact
 * card anchored to the lower-right quadrant (`.by-shell__rail--color` in AppShell.css),
 * with the current pick shown large up top and the rest clustered below rather than
 * lined up in a strict grid.
 *
 * Swatches carry the real LDraw RGB as data — per docs/DESIGN.md the palette is not
 * reinterpreted, so a swatch can be any colour at all. Material class gets a stylised
 * overlay per finish (`by-swatch--*`, see components.css) that reads at swatch size
 * without changing the swatch's own fill; the selected state is the theme-accent ring
 * drawn outside the swatch, never a tint on it.
 *
 * Solids are the overwhelming majority of real usage and stay visible by default;
 * every other finish collapses into a `<details>` accordion, native keyboard support
 * included.
 */
export function ColorPicker({ colors, selectedCode, onSelect }: ColorPickerProps) {
  const [othersOpen, setOthersOpen] = useState(false);

  const byMaterial = useMemo(() => groupByMaterial(colors), [colors]);
  const solids = useMemo(() => byMaterial.get('solid') ?? [], [byMaterial]);
  const otherGroups = useMemo<Group[]>(
    () =>
      OTHER_MATERIAL_ORDER.filter((material) => byMaterial.has(material)).map((material) => ({
        material,
        colors: byMaterial.get(material)!,
      })),
    [byMaterial],
  );
  const otherCount = otherGroups.reduce((sum, group) => sum + group.colors.length, 0);

  const visibleColors = useMemo(
    () => (othersOpen ? colors : solids),
    [othersOpen, colors, solids],
  );
  const { containerRef, onKeyDown } = useRovingGrid(visibleColors.length);
  const indexOf = useMemo(() => {
    const map = new Map<number, number>();
    visibleColors.forEach((color, i) => map.set(color.code, i));
    return map;
  }, [visibleColors]);

  const current = colors.find((color) => color.code === selectedCode);

  return (
    <div className="by-palette-wrap">
      <div className="by-panel by-palette">
        <div className="by-panel__head">
          <div className="by-panel__title">Color Palette</div>
        </div>
        <div className="by-panel__body" ref={containerRef}>
          {current !== undefined && (
            <div className="by-palette__current">
              <span
                className={`by-palette__blob ${MATERIAL_MARK[current.material]}`}
                style={{ backgroundColor: current.hex, borderColor: current.edgeHex }}
                aria-hidden="true"
              />
              <span className="by-palette__current-text">
                <span className="by-palette__current-name">{current.name}</span>
                <span className="by-mono by-faint">{current.code} · {MATERIAL_LABEL[current.material]}</span>
              </span>
            </div>
          )}

          <div className="by-eyebrow" style={{ marginBottom: 'var(--by-space-2)' }}>
            Solid
          </div>
          <div className="by-palette__cluster" aria-label="Solid">
            <Swatches
              colors={solids}
              selectedCode={selectedCode}
              indexOf={indexOf}
              onSelect={onSelect}
              onKeyDown={onKeyDown}
            />
          </div>

          <details
            className="by-accordion"
            open={othersOpen}
            onToggle={(event) => setOthersOpen(event.currentTarget.open)}
          >
            <summary className="by-accordion__summary">
              <ChevronDownIcon className="by-accordion__chevron" />
              More finishes
              <span className="by-mono by-faint">{otherCount}</span>
            </summary>
            <div className="by-accordion__body">
              {otherGroups.map((group, groupIndex) => (
                <div key={group.material} style={{ marginTop: groupIndex === 0 ? 0 : 'var(--by-space-3)' }}>
                  <div className="by-eyebrow" style={{ marginBottom: 'var(--by-space-2)' }}>
                    {MATERIAL_LABEL[group.material]}
                  </div>
                  <div className="by-palette__cluster" aria-label={MATERIAL_LABEL[group.material]}>
                    <Swatches
                      colors={group.colors}
                      selectedCode={selectedCode}
                      indexOf={indexOf}
                      onSelect={onSelect}
                      onKeyDown={onKeyDown}
                    />
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
