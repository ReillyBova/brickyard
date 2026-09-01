/**
 * Render mode's top-left panel — the parts chest is meaningless once nothing is being placed,
 * so this occupies its rail instead of adding new chrome (per the design system's
 * one-panel-per-rail rule). An environment dropdown (`EnvironmentMenu`), continuous dials for
 * the key light, and the ground controls (`GroundSection`): every one of them changes the
 * traced image the instant it's touched, none of them wait on a scene rebake to *show* the
 * change — see `PathTracerController.updateLighting`/`updateEnvironment` for the light/env
 * side, and `updateGroundMaterial`/`updateGroundGeometry` for the ground side, where only a
 * size/visibility change still costs a real (if narrowed) rebuild.
 */

import { useRef } from 'react';

import { useRovingGrid } from '../../ui/useRovingGrid';
import { useTooltip, useTooltipDelegate } from '../../ui/tooltip';

import { EnvironmentMenu } from './EnvironmentMenu.tsx';
import {
  GROUND_FINISH_LABEL,
  GROUND_FINISH_TOOLTIP,
  GROUND_SIZE_LABEL,
  GROUND_SIZE_TOOLTIP,
  GROUND_SWATCHES,
} from './ground.ts';
import type { GroundFinish, GroundSettings, GroundSize } from './ground.ts';
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

const GROUND_SIZES: readonly GroundSize[] = ['tight', 'medium', 'broad', 'infinite'];
const GROUND_FINISHES: readonly GroundFinish[] = ['matte', 'satin', 'glossy', 'mirror'];

interface GroundSectionProps {
  ground: GroundSettings;
  onChange: (ground: GroundSettings) => void;
}

/** The ground controls: visible/hidden, size, finish and colour — all independent of which
 *  environment is lighting the scene (see `ground.ts`). Split out of `RenderPanel` for the same
 *  reason `DialRow` is: several of `useTooltip`/`useTooltipDelegate` calls need to live outside
 *  any loop. */
function GroundSection({ ground, onChange }: GroundSectionProps) {
  const swatchGridRef = useRef<HTMLDivElement | null>(null);
  const { containerRef: rovingRef, onKeyDown: onSwatchKeyDown } = useRovingGrid(GROUND_SWATCHES.length);
  useTooltipDelegate(swatchGridRef, 'render-ground-swatches');

  const setSwatchRefs = (node: HTMLDivElement | null) => {
    swatchGridRef.current = node;
    rovingRef.current = node;
  };

  const visibleTip = useTooltip({
    id: 'render-ground-visible',
    label: 'Show the grounding floor the model sits on',
  });

  const set = <K extends keyof GroundSettings>(key: K, value: GroundSettings[K]): void => {
    onChange({ ...ground, [key]: value });
  };

  return (
    <div className="by-panel__section">
      <p className="by-eyebrow">Ground</p>
      <div className="by-row">
        <span>Show ground</span>
        <button
          type="button"
          className={`by-switch${ground.visible ? ' is-on' : ''}`}
          role="switch"
          aria-checked={ground.visible}
          aria-label="Show ground"
          onClick={() => set('visible', !ground.visible)}
          {...visibleTip}
        />
      </div>

      <p className="by-eyebrow">Size</p>
      <div className="by-seg" role="radiogroup" aria-label="Ground size">
        {GROUND_SIZES.map((size) => (
          <GroundSegOption
            key={size}
            id={`render-ground-size-${size}`}
            label={GROUND_SIZE_LABEL[size]}
            tooltip={GROUND_SIZE_TOOLTIP[size]}
            active={ground.size === size}
            disabled={!ground.visible}
            onSelect={() => set('size', size)}
          />
        ))}
      </div>

      <p className="by-eyebrow">Finish</p>
      <div className="by-seg" role="radiogroup" aria-label="Ground finish">
        {GROUND_FINISHES.map((finish) => (
          <GroundSegOption
            key={finish}
            id={`render-ground-finish-${finish}`}
            label={GROUND_FINISH_LABEL[finish]}
            tooltip={GROUND_FINISH_TOOLTIP[finish]}
            active={ground.finish === finish}
            disabled={!ground.visible}
            onSelect={() => set('finish', finish)}
          />
        ))}
      </div>

      <p className="by-eyebrow">Colour</p>
      <div
        className="by-swatch-grid"
        ref={setSwatchRefs}
        role="radiogroup"
        aria-label="Ground colour"
      >
        {GROUND_SWATCHES.map((swatch, index) => {
          const isSelected = ground.color[0] === swatch.color[0]
            && ground.color[1] === swatch.color[1]
            && ground.color[2] === swatch.color[2];
          return (
            <button
              key={swatch.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={swatch.label}
              disabled={!ground.visible}
              className={`by-swatch${isSelected ? ' is-selected' : ''}`}
              style={{ backgroundColor: `rgb(${swatch.color.map((c) => Math.round(c * 255)).join(',')})` }}
              data-index={index}
              data-tooltip-id={`render-ground-swatch-${swatch.id}`}
              data-tooltip-label={swatch.label}
              onClick={() => set('color', swatch.color)}
              onKeyDown={(event) => onSwatchKeyDown(event, index)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface GroundSegOptionProps {
  id: string;
  label: string;
  tooltip: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function GroundSegOption({ id, label, tooltip, active, disabled, onSelect }: GroundSegOptionProps) {
  const tip = useTooltip({ id, label: tooltip, groupId: 'render-ground-seg', disabled });

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      className={`by-seg__opt${active ? ' is-active' : ''}`}
      onClick={onSelect}
      {...tip}
    >
      {label}
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
          <EnvironmentMenu value={environment} onChange={onEnvironmentChange} />
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

        <GroundSection ground={lighting.ground} onChange={(ground) => set('ground', ground)} />
      </div>
    </div>
  );
}
