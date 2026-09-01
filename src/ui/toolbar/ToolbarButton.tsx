import { useContext } from 'react';

import { ToolbarTooltipContext } from './tooltipContext';
import type { ToolbarAction } from './types';

/**
 * One `.by-icon-btn` plus its hover/focus tooltip. Every `ToolbarAction` renders
 * through this so tooltip timing and shortcut display are uniform across the toolbar —
 * a contributing slice never builds its own tooltip.
 */
export function ToolbarButton({ action, groupId }: { action: ToolbarAction; groupId: string }) {
  const { openId, show, hide } = useContext(ToolbarTooltipContext);
  const tooltipId = `by-toolbar-tip-${action.id}`;

  return (
    <span className="by-toolbar__item">
      <button
        type="button"
        className={`by-icon-btn${action.active ? ' is-active' : ''}`}
        aria-label={action.label}
        aria-pressed={action.active}
        aria-describedby={openId === action.id ? tooltipId : undefined}
        disabled={action.disabled}
        onClick={action.onClick}
        onMouseEnter={() => show(action.id, groupId)}
        onMouseLeave={hide}
        onFocus={() => show(action.id, groupId)}
        onBlur={hide}
      >
        {action.icon}
      </button>
      {openId === action.id && (
        <span className="by-toolbar__tip" role="tooltip" id={tooltipId}>
          <span className="by-tooltip">
            <span>{action.label}</span>
            {action.shortcut && (
              <span className="by-kbd-set">
                {action.shortcut.map((key, i) => (
                  // Shortcut glyphs repeat within a combo (e.g. two modifiers), so index
                  // is the only stable key here.
                  // eslint-disable-next-line react/no-array-index-key
                  <span className="by-kbd" key={i}>
                    {key}
                  </span>
                ))}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
