import './Toolbar.css';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarModeSwitchView } from './ToolbarModeSwitchView';
import { ToolbarTooltipProvider } from './ToolbarTooltipProvider';
import type { ToolbarItem } from './types';

interface ToolbarProps {
  items: readonly ToolbarItem[];
}

/**
 * Renders `ToolbarItem[]` — command groups as `.by-tool-group` pills, left-packed in
 * order, and the one mode switch as `.by-seg` pinned to the bar's right corner
 * (`.by-toolbar__mode`, Toolbar.css) — the user-directed placement, distinct from the
 * command groups it sits apart from. This is the only place that lays out toolbar
 * controls — see `types.ts` for the contract a feature builds against to contribute
 * one.
 *
 * Editor-only actions still to land here, each a `ToolbarAction` added to the `items`
 * array assembled by the composition root (`src/App.tsx`) — nothing here needs to change
 * to receive them:
 *   - paintbrush (restyle) — an action *within* the editor mode, not a mode of its own;
 *     opens a panel over the editor, docs/ROADMAP.md "Restyle"
 *
 * The app's one mode switch — editor / graph / render — is a `ToolbarModeSwitch`, not a
 * group of actions; see `types.ts` for why it doesn't fit `ToolbarAction`.
 */
export function Toolbar({ items }: ToolbarProps) {
  return (
    <ToolbarTooltipProvider>
      <div className="by-toolbar">
        {items.map((item) => {
          if (item.kind === 'modeSwitch') {
            return (
              <div className="by-toolbar__mode" key={item.modeSwitch.id}>
                <ToolbarModeSwitchView modeSwitch={item.modeSwitch} />
              </div>
            );
          }
          const { group } = item;
          return (
            <div className="by-tool-group" key={group.id} role="group">
              {group.actions.map((action) => (
                <ToolbarButton action={action} groupId={group.id} key={action.id} />
              ))}
            </div>
          );
        })}
      </div>
    </ToolbarTooltipProvider>
  );
}
