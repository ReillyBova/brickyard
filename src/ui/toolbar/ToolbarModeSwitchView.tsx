import type { ToolbarModeSwitch } from './types';

/** Renders a `ToolbarModeSwitch` as `.by-seg` — the Build/Render switch's own shape. */
export function ToolbarModeSwitchView({ modeSwitch }: { modeSwitch: ToolbarModeSwitch }) {
  return (
    <div className="by-seg" role="group" aria-label={modeSwitch.id}>
      {modeSwitch.options.map((option) => (
        <button
          type="button"
          key={option.id}
          className={`by-seg__opt${option.id === modeSwitch.value ? ' is-active' : ''}`}
          aria-pressed={option.id === modeSwitch.value}
          disabled={modeSwitch.disabled}
          onClick={() => modeSwitch.onChange(option.id)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
