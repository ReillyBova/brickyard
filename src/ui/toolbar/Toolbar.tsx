import './Toolbar.css';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarModeSwitchView } from './ToolbarModeSwitchView';
import { ToolbarTooltipProvider } from './ToolbarTooltipProvider';
import type { ToolbarItem } from './types';

interface ToolbarProps {
  items: readonly ToolbarItem[];
}

/**
 * Renders `ToolbarItem[]` in order — a command group as a `.by-tool-group` pill, a mode
 * switch as `.by-seg`. This is the only place that lays out toolbar controls — see
 * `types.ts` for the contract a feature builds against to contribute one.
 *
 * Editor-only actions still to land here, each a `ToolbarAction` added to the `items`
 * array assembled by the composition root (`src/App.tsx`) — nothing here needs to change
 * to receive them:
 *   - paintbrush (restyle) — opens a panel over the editor, docs/ROADMAP.md "Restyle"
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
            return <ToolbarModeSwitchView modeSwitch={item.modeSwitch} key={item.modeSwitch.id} />;
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
