/**
 * The restyle panel: every color in the loaded model, most-used first, each mapped to
 * a replacement from the real LDraw palette. Apply commits the whole mapping as one
 * transaction — see `transaction.ts` — so the entire restyle is a single undo step.
 *
 * Pure presentation: all state (the mapping, what "apply" does) lives with the caller,
 * per docs/ARCHITECTURE.md's "document is the only writable state" — this component
 * never touches a `SceneDocument` directly, only the `ColorUsage` summary and the
 * mapping it's given.
 */
import { ArrowRightIcon, PaintbrushIcon, Undo2Icon, XIcon } from '../../ui/icons';
import { useTooltip } from '../../ui/tooltip';
import type { Swatch } from '../../ui/ColorPicker/types';
import { ColorTargetPicker } from './ColorTargetPicker';
import type { ColorUsage } from './colorUsage';
import type { ColorMapping } from './transaction';
import './Restyle.css';

export interface RestylePanelProps {
  usage: readonly ColorUsage[];
  palette: readonly Swatch[];
  mapping: ColorMapping;
  onMap: (from: number, to: number) => void;
  onResetRow: (from: number) => void;
  onResetAll: () => void;
  onApply: () => void;
  onClose: () => void;
  /** Bricks the current mapping would actually recolor. */
  changedBrickCount: number;
  applying?: boolean;
}

function swatchFor(palette: readonly Swatch[], code: number): Swatch | undefined {
  return palette.find((s) => s.code === code);
}

function nameFor(palette: readonly Swatch[], code: number): string {
  return swatchFor(palette, code)?.name ?? `Color ${code}`;
}

interface RestyleRowProps {
  code: number;
  count: number;
  palette: readonly Swatch[];
  mapping: ColorMapping;
  onMap: (from: number, to: number) => void;
  onResetRow: (from: number) => void;
}

/**
 * Split out from `RestylePanel`'s `usage.map()` so the reset button's `useTooltip` call
 * — one per row — is a hook call in a real component, not inside a loop callback.
 */
function RestyleRow({ code, count, palette, mapping, onMap, onResetRow }: RestyleRowProps) {
  const target = mapping.get(code) ?? code;
  const changed = target !== code;
  const from = swatchFor(palette, code);
  const name = nameFor(palette, code);
  const resetTip = useTooltip({ id: `restyle-reset-${code}`, label: 'Reset to original color' });

  return (
    <div className="by-restyle-row">
      <span
        className="by-swatch by-restyle-row__from"
        style={{ backgroundColor: from?.hex, borderColor: from?.edgeHex }}
        aria-hidden="true"
      />
      <span className="by-restyle-row__name">{name}</span>
      <span className="by-tag by-tag--neutral by-mono">{count}</span>
      <ArrowRightIcon className="by-restyle-row__arrow" aria-hidden="true" />
      <ColorTargetPicker
        palette={palette}
        value={target}
        onSelect={(next) => onMap(code, next)}
        label={`Replacement for ${name}`}
      />
      <button
        type="button"
        className="by-icon-btn by-restyle-row__reset"
        aria-label={`Reset ${name} to its original color`}
        onClick={() => onResetRow(code)}
        disabled={!changed}
        {...resetTip}
      >
        <Undo2Icon />
      </button>
    </div>
  );
}

export function RestylePanel({
  usage,
  palette,
  mapping,
  onMap,
  onResetRow,
  onResetAll,
  onApply,
  onClose,
  changedBrickCount,
  applying = false,
}: RestylePanelProps) {
  const hasChanges = mapping.size > 0;
  const closeTip = useTooltip({ id: 'restyle-close', label: 'Close restyle panel' });

  return (
    <div className="by-panel by-restyle-panel">
      <div className="by-panel__head">
        <PaintbrushIcon className="by-restyle-panel__icon" />
        <div className="by-panel__title">Restyle</div>
        <button
          type="button"
          className="by-icon-btn"
          aria-label="Close restyle panel"
          onClick={onClose}
          {...closeTip}
        >
          <XIcon />
        </button>
      </div>

      <div className="by-panel__body">
        {usage.length === 0 ? (
          <div className="by-empty">
            <p className="by-empty__title">Nothing to restyle</p>
            <p className="by-empty__body">Load a model with bricks on the baseplate first.</p>
          </div>
        ) : (
          <div className="by-restyle-rows">
            {usage.map(({ code, count }) => (
              <RestyleRow
                key={code}
                code={code}
                count={count}
                palette={palette}
                mapping={mapping}
                onMap={onMap}
                onResetRow={onResetRow}
              />
            ))}
          </div>
        )}
      </div>

      <div className="by-panel__foot by-restyle-panel__foot">
        <span className="by-restyle-panel__summary by-mono by-faint">
          {hasChanges
            ? `${changedBrickCount} ${changedBrickCount === 1 ? 'brick' : 'bricks'} will change`
            : 'No changes yet'}
        </span>
        <button
          type="button"
          className="by-btn by-btn--secondary by-btn--sm"
          onClick={onResetAll}
          disabled={!hasChanges}
        >
          Reset all
        </button>
        <button
          type="button"
          className="by-btn by-btn--primary by-btn--sm"
          onClick={onApply}
          disabled={!hasChanges || applying}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
