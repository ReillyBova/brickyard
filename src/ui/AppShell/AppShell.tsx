import { useState, type ReactNode } from 'react';

import './AppShell.css';

interface AppShellProps {
  chestPanel: ReactNode;
  colorPanel: ReactNode;
  /**
   * Fills the viewport. Passed in as a node so this slice never imports from
   * `src/scene/` — the composition root decides what renders there. Omitted, the
   * empty state shows instead.
   */
  viewport?: ReactNode;
}

/**
 * The app frame: a full-bleed viewport with the parts chest and color palette floating
 * over it, per docs/DESIGN.md. The viewport content arrives as a prop, so this
 * component owns only the chrome around it.
 *
 * The chest is a full-height rail on the left. The color palette is not: it's a
 * frequently-touched, browse-y control rather than a settings list, so it floats as a
 * smaller card anchored to the lower-right quadrant instead of claiming a whole rail
 * (see `.by-shell__rail--color` in AppShell.css).
 *
 * At narrow widths both panels collapse into on-demand overlays opened from a compact
 * bar, so the viewport always keeps the full window.
 */
export function AppShell({ chestPanel, colorPanel, viewport }: AppShellProps) {
  const [openRail, setOpenRail] = useState<'chest' | 'color' | null>(null);

  return (
    <div className="by-viewport">
      {viewport ?? (
        <div className="by-empty">
          <p className="by-empty__title">Nothing on the baseplate yet</p>
          <p className="by-empty__body">Open the chest and pick a piece.</p>
        </div>
      )}

      <div className="by-shell">
        <div className="by-shell__bar">
          <span className="by-shell__wordmark">BrickYard</span>
          <div className="by-seg" role="group" aria-label="Panels">
            <button
              type="button"
              className={`by-seg__opt${openRail === 'chest' ? ' is-active' : ''}`}
              aria-pressed={openRail === 'chest'}
              onClick={() => setOpenRail((current) => (current === 'chest' ? null : 'chest'))}
            >
              Parts
            </button>
            <button
              type="button"
              className={`by-seg__opt${openRail === 'color' ? ' is-active' : ''}`}
              aria-pressed={openRail === 'color'}
              onClick={() => setOpenRail((current) => (current === 'color' ? null : 'color'))}
            >
              Color
            </button>
          </div>
        </div>

        <div
          className={`by-shell__rail by-shell__rail--chest${openRail === 'chest' ? '' : ' is-closed'}`}
        >
          {chestPanel}
        </div>

        <div
          className={`by-shell__rail by-shell__rail--color${openRail === 'color' ? '' : ' is-closed'}`}
        >
          {colorPanel}
        </div>
      </div>
    </div>
  );
}
