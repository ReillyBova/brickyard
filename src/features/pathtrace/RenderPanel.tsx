/**
 * Render mode's top-left panel — the parts chest is meaningless once nothing is being placed,
 * so this occupies its rail instead of adding new chrome (per the design system's
 * one-panel-per-rail rule). An environment map picker plus continuous dials for the key light:
 * every one of them, including the environment choice, changes the traced image the instant
 * it's touched (see `PathTracerController.updateLighting`/`updateEnvironment` — no dial here
 * waits on a scene rebake).
 */

import { useTooltip } from '../../ui/tooltip';
import { ENVIRONMENTS } from './environments.ts';
import type { PathtraceEnvironment } from './environments.ts';
import type { LightingSettings } from './lighting.ts';
import './pathtrace.css';

interface RenderPanelProps {
  environment: PathtraceEnvironment;
  onEnvironmentChange: (environment: PathtraceEnvironment) => void;
  lighting: LightingSettings;
  onLightingChange: (lighting: LightingSettings) => void;
}

interface DialRowProps {
  id: string;
  label: string;
  tooltip: string;
  min: number;
  max: number;
  step: number;
  value: number;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}

/** One `.by-row` with a native range input skinned as `.by-slider`, plus its live numeric
 *  readout. Split out so `useTooltip` (one hook call per control) isn't called in a loop. */
function DialRow({ id, label, tooltip, min, max, step, value, formatValue, onChange }: DialRowProps) {
  const tip = useTooltip({ id: `render-dial-${id}`, label: tooltip, groupId: 'render-dials' });

  return (
    <div className="by-row">
      <span>{label}</span>
      <span className="by-render-dial">
        <input
          type="range"
          className="by-slider"
          id={id}
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={tooltip}
          onChange={(event) => onChange(Number(event.target.value))}
          {...tip}
        />
        <span className="by-mono by-render-dial__value">{formatValue(value)}</span>
      </span>
    </div>
  );
}

interface EnvironmentOptionProps {
  environment: PathtraceEnvironment;
  active: boolean;
  onSelect: () => void;
}

function EnvironmentOption({ environment, active, onSelect }: EnvironmentOptionProps) {
  const tip = useTooltip({
    id: `render-env-${environment.id}`,
    label: environment.description,
    groupId: 'render-environments',
  });

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={`by-seg__opt${active ? ' is-active' : ''}`}
      onClick={onSelect}
      {...tip}
    >
      {environment.label}
    </button>
  );
}

export function RenderPanel({ environment, onEnvironmentChange, lighting, onLightingChange }: RenderPanelProps) {
  const set = <K extends keyof LightingSettings>(key: K, value: LightingSettings[K]): void => {
    onLightingChange({ ...lighting, [key]: value });
  };

  const backgroundTip = useTooltip({
    id: 'render-show-background',
    label: 'Show the environment behind the model instead of a plain background',
  });

  return (
    <div className="by-panel">
      <div className="by-panel__head">
        <span className="by-panel__title">Render</span>
      </div>
      <div className="by-panel__body">
        <div className="by-panel__section">
          <p className="by-eyebrow">Environment</p>
          <div className="by-seg by-seg--wrap" role="radiogroup" aria-label="Environment">
            {ENVIRONMENTS.map((env) => (
              <EnvironmentOption
                key={env.id}
                environment={env}
                active={env.id === environment.id}
                onSelect={() => onEnvironmentChange(env)}
              />
            ))}
          </div>
          <div className="by-row">
            <span>Show background</span>
            <button
              type="button"
              className={`by-switch${lighting.showBackground ? ' is-on' : ''}`}
              role="switch"
              aria-checked={lighting.showBackground}
              aria-label="Show background"
              onClick={() => set('showBackground', !lighting.showBackground)}
              {...backgroundTip}
            />
          </div>
          <DialRow
            id="render-env-rotation"
            label="Rotation"
            tooltip="Rotate the environment map around the model"
            min={0}
            max={360}
            step={1}
            value={lighting.envRotationDeg}
            formatValue={(v) => `${Math.round(v)}°`}
            onChange={(v) => set('envRotationDeg', v)}
          />
        </div>

        <div className="by-panel__section">
          <p className="by-eyebrow">Key light</p>
          <DialRow
            id="render-light-azimuth"
            label="Direction"
            tooltip="Swing the key light around the model"
            min={0}
            max={360}
            step={1}
            value={lighting.azimuthDeg}
            formatValue={(v) => `${Math.round(v)}°`}
            onChange={(v) => set('azimuthDeg', v)}
          />
          <DialRow
            id="render-light-elevation"
            label="Height"
            tooltip="Raise or lower the key light above the horizon"
            min={2}
            max={90}
            step={1}
            value={lighting.elevationDeg}
            formatValue={(v) => `${Math.round(v)}°`}
            onChange={(v) => set('elevationDeg', v)}
          />
          <DialRow
            id="render-light-warmth"
            label="Warmth"
            tooltip="Colour temperature of the key light, from candle-warm to overcast-blue"
            min={1500}
            max={12000}
            step={100}
            value={lighting.warmthK}
            formatValue={(v) => `${Math.round(v)}K`}
            onChange={(v) => set('warmthK', v)}
          />
          <DialRow
            id="render-light-intensity"
            label="Intensity"
            tooltip="Brightness of the key light"
            min={0}
            max={8}
            step={0.1}
            value={lighting.intensity}
            formatValue={(v) => v.toFixed(1)}
            onChange={(v) => set('intensity', v)}
          />
          <DialRow
            id="render-light-softness"
            label="Softness"
            tooltip="Shadow character, from a hard point source to a big soft one"
            min={0}
            max={1}
            step={0.01}
            value={lighting.softness}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set('softness', v)}
          />
        </div>

        <div className="by-panel__section">
          <p className="by-eyebrow">Scene</p>
          <DialRow
            id="render-exposure"
            label="Exposure"
            tooltip="Overall brightness of the rendered image"
            min={0.1}
            max={3}
            step={0.05}
            value={lighting.exposure}
            formatValue={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => set('exposure', v)}
          />
        </div>
      </div>
    </div>
  );
}
