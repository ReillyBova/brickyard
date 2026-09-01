import { useContext } from 'react';

import { ToolbarTooltipContext } from './tooltipContext';
import type { ToolbarModeSwitch } from './types';

/**
 * Renders a `ToolbarModeSwitch` as `.by-seg` — the Build/Render switch's own shape,
 * icon-only (no visible label) so three options plus the wordmark and theme toggle
 * still fit the bar at narrow widths. Each option carries the same hover/focus tooltip
 * every `ToolbarButton` gets, via the same `ToolbarTooltipContext` — the whole switch is
 * one tooltip group, so moving between its own options never re-waits the 400ms.
 */
export function ToolbarModeSwitchView({ modeSwitch }: { modeSwitch: ToolbarModeSwitch }) {
  const { openId, show, hide } = useContext(ToolbarTooltipContext);

  return (
    <div className="by-seg" role="group" aria-label={modeSwitch.id}>
      {modeSwitch.options.map((option) => {
        const tooltipId = `by-toolbar-tip-${modeSwitch.id}-${option.id}`;
        return (
          <span className="by-toolbar__item" key={option.id}>
            <button
              type="button"
              className={`by-seg__opt${option.id === modeSwitch.value ? ' is-active' : ''}`}
              aria-label={option.label}
              aria-pressed={option.id === modeSwitch.value}
              aria-describedby={openId === option.id ? tooltipId : undefined}
              disabled={modeSwitch.disabled}
              onClick={() => modeSwitch.onChange(option.id)}
              onMouseEnter={() => show(option.id, modeSwitch.id)}
              onMouseLeave={hide}
              onFocus={() => show(option.id, modeSwitch.id)}
              onBlur={hide}
            >
              {option.icon}
            </button>
            {openId === option.id && (
              <span className="by-toolbar__tip" role="tooltip" id={tooltipId}>
                <span className="by-tooltip">
                  <span>{option.label}</span>
                </span>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
