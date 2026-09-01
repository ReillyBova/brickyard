import './Toolbar.css';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarTooltipProvider } from './ToolbarTooltipProvider';
import type { ToolbarGroup } from './types';

interface ToolbarProps {
  groups: readonly ToolbarGroup[];
}

/**
 * Renders `ToolbarGroup[]` as `.by-tool-group` pill rafts, in order. This is the only
 * place that lays out toolbar actions — see `types.ts` for the contract a feature
 * builds against to contribute one.
 *
 * Empty slots, filled by other slices, not this one:
 *   - paintbrush (restyle) — bulk semantic recolor, docs/ROADMAP.md "Restyle"
 *   - graph / explode — the connection graph made visible, docs/ROADMAP.md "Graph explode"
 *   - render-mode toggle — Build/Render `.by-seg`, docs/ROADMAP.md "Ray-traced render mode"
 * Each contributes a `ToolbarAction` (or a `ToolbarGroup` of its own) and is added to the
 * `groups` array assembled by the composition root (`src/App.tsx`) — nothing here needs to
 * change to receive it.
 */
export function Toolbar({ groups }: ToolbarProps) {
  return (
    <ToolbarTooltipProvider>
      <div className="by-toolbar">
        {groups.map((group) => (
          <div className="by-tool-group" key={group.id} role="group">
            {group.actions.map((action) => (
              <ToolbarButton action={action} groupId={group.id} key={action.id} />
            ))}
          </div>
        ))}
      </div>
    </ToolbarTooltipProvider>
  );
}
