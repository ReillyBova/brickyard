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

  return (
    <div className="by-panel by-restyle-panel">
      <div className="by-panel__head">
        <PaintbrushIcon className="by-restyle-panel__icon" />
        <div className="by-panel__title">Restyle</div>
        <button
          type="button"
          className="by-icon-btn"
          aria-label="Close restyle panel"
          title="Close restyle panel"
          onClick={onClose}
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
            {usage.map(({ code, count }) => {
              const target = mapping.get(code) ?? code;
              const changed = target !== code;
              const from = swatchFor(palette, code);
              return (
                <div className="by-restyle-row" key={code}>
                  <span
                    className="by-swatch by-restyle-row__from"
                    style={{ backgroundColor: from?.hex, borderColor: from?.edgeHex }}
                    aria-hidden="true"
                  />
                  <span className="by-restyle-row__name">{nameFor(palette, code)}</span>
                  <span className="by-tag by-tag--neutral by-mono">{count}</span>
                  <ArrowRightIcon className="by-restyle-row__arrow" aria-hidden="true" />
                  <ColorTargetPicker
                    palette={palette}
                    value={target}
                    onSelect={(next) => onMap(code, next)}
                    label={`Replacement for ${nameFor(palette, code)}`}
                  />
                  <button
                    type="button"
                    className="by-icon-btn by-restyle-row__reset"
                    aria-label={`Reset ${nameFor(palette, code)} to its original color`}
                    title="Reset to original color"
                    onClick={() => onResetRow(code)}
                    disabled={!changed}
                  >
                    <Undo2Icon />
                  </button>
                </div>
              );
            })}
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
