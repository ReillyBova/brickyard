/**
 * Render mode's top-left panel — the parts chest is meaningless once nothing is being
 * placed, so this occupies its rail instead of adding new chrome (per the design system's
 * one-panel-per-rail rule). Two segmented choices: which procedural environment (sky +
 * grounding floor) the model sits in, and which lighting preset lights it.
 */

import { ENVIRONMENTS } from './environments.ts';
import type { PathtraceEnvironment } from './environments.ts';
import { LIGHTING_PRESETS } from './lighting.ts';
import type { LightingPreset } from './lighting.ts';

interface EnvironmentPanelProps {
  environment: PathtraceEnvironment;
  onEnvironmentChange: (environment: PathtraceEnvironment) => void;
  lighting: LightingPreset;
  onLightingChange: (lighting: LightingPreset) => void;
}

export function EnvironmentPanel({
  environment,
  onEnvironmentChange,
  lighting,
  onLightingChange,
}: EnvironmentPanelProps) {
  return (
    <div className="by-panel">
      <div className="by-panel__head">
        <span className="by-panel__title">Render</span>
      </div>
      <div className="by-panel__body">
        <div className="by-panel__section">
          <p className="by-eyebrow">Environment</p>
          <div className="by-seg" role="radiogroup" aria-label="Environment">
            {ENVIRONMENTS.map((env) => (
              <button
                key={env.id}
                type="button"
                role="radio"
                aria-checked={env.id === environment.id}
                className={`by-seg__opt${env.id === environment.id ? ' is-active' : ''}`}
                title={`${env.label} — sky and grounding floor`}
                onClick={() => onEnvironmentChange(env)}
              >
                {env.label}
              </button>
            ))}
          </div>
        </div>
        <div className="by-panel__section">
          <p className="by-eyebrow">Lighting</p>
          <div className="by-seg by-seg--wrap" role="radiogroup" aria-label="Lighting">
            {LIGHTING_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={preset.id === lighting.id}
                className={`by-seg__opt${preset.id === lighting.id ? ' is-active' : ''}`}
                title={preset.description}
                onClick={() => onLightingChange(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
