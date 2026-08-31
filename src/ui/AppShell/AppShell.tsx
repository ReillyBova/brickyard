import { useState, type ReactNode } from 'react';

import './AppShell.css';

interface AppShellProps {
  chestPanel: ReactNode;
  colorPanel: ReactNode;
}

/**
 * The app frame: a full-bleed viewport with the chest and colour panels floating over
 * it as rails, per docs/DESIGN.md. The viewport itself is a placeholder — the scene
 * slice fills `.by-viewport` later; this component owns only the chrome around it.
 *
 * At narrow widths the rails would crowd the viewport, so they collapse into on-demand
 * overlays opened from a compact bar, and the viewport always keeps the full window.
 */
export function AppShell({ chestPanel, colorPanel }: AppShellProps) {
  const [openRail, setOpenRail] = useState<'chest' | 'color' | null>(null);

  return (
    <div className="by-viewport">
      <div className="by-empty">
        <p className="by-empty__title">Nothing on the baseplate yet</p>
        <p className="by-empty__body">Open the chest and pick a piece.</p>
      </div>

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
              Chest
            </button>
            <button
              type="button"
              className={`by-seg__opt${openRail === 'color' ? ' is-active' : ''}`}
              aria-pressed={openRail === 'color'}
              onClick={() => setOpenRail((current) => (current === 'color' ? null : 'color'))}
            >
              Colour
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
