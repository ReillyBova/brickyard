import { useEffect, useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * Reads `docs/DESIGN.md`'s token scale straight from `tokens.css` via
 * `getComputedStyle`, so this story can never drift from the sheet — it names tokens,
 * it never copies their values. A `MutationObserver` on `<html data-theme>` forces a
 * re-read whenever the Storybook theme toolbar flips, since the values themselves are
 * read once into React state rather than re-evaluated by the browser on every render.
 */
function useToken(name: string): string {
  const [value, setValue] = useState('');
  useEffect(() => {
    const read = () => setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [name]);
  return value;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 'var(--by-space-8)' }}>
      <h2
        style={{
          font: 'inherit',
          fontFamily: 'var(--by-font-display)',
          fontWeight: 'var(--by-font-display-weight)',
          fontSize: 'var(--by-text-xl)',
          marginBottom: 'var(--by-space-4)',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--by-space-3)', alignItems: 'flex-end' }}>
      {children}
    </div>
  );
}

function ColorSwatch({ token, label }: { token: string; label: string }) {
  const value = useToken(token);
  return (
    <div style={{ width: 140 }}>
      <div
        style={{
          height: 64,
          borderRadius: 'var(--by-radius-md)',
          background: `var(${token})`,
          border: '1px solid var(--by-line)',
        }}
      />
      <div style={{ marginTop: 'var(--by-space-1)', fontSize: 'var(--by-text-xs)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--by-font-mono)', fontSize: 'var(--by-text-2xs)', color: 'var(--by-text-faint)' }}>
        {token} · {value || '—'}
      </div>
    </div>
  );
}

const SEMANTIC_COLOR_TOKENS: readonly { token: string; label: string }[] = [
  { token: '--by-canvas', label: 'Canvas' },
  { token: '--by-canvas-grid', label: 'Canvas grid' },
  { token: '--by-chrome', label: 'Chrome' },
  { token: '--by-panel', label: 'Panel' },
  { token: '--by-panel-sunken', label: 'Panel sunken' },
  { token: '--by-popover', label: 'Popover' },
  { token: '--by-text', label: 'Text' },
  { token: '--by-text-muted', label: 'Text muted' },
  { token: '--by-text-faint', label: 'Text faint' },
  { token: '--by-accent', label: 'Accent' },
  { token: '--by-accent-hover', label: 'Accent hover' },
  { token: '--by-accent-press', label: 'Accent press' },
  { token: '--by-accent-text', label: 'Accent text' },
  { token: '--by-structure', label: 'Structure (sage)' },
  { token: '--by-danger', label: 'Danger' },
];

const NEUTRAL_RAMP = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => ({
  token: `--color-neutral-${step}`,
  label: `Neutral ${step}`,
}));
const ACCENT_RAMP = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => ({
  token: `--color-accent-${step}`,
  label: `Terracotta ${step}`,
}));
const ACCENT_2_RAMP = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => ({
  token: `--color-accent-2-${step}`,
  label: `Sage ${step}`,
}));

const TYPE_SCALE: readonly { token: string; label: string }[] = [
  { token: '--by-text-2xs', label: '2xs — ramp labels, swatch codes' },
  { token: '--by-text-xs', label: 'xs — metadata, shortcuts, captions' },
  { token: '--by-text-sm', label: 'sm — dense labels, tile captions' },
  { token: '--by-text-md', label: 'md — the interface default' },
  { token: '--by-text-lg', label: 'lg — body copy, empty states' },
  { token: '--by-text-xl', label: 'xl — panel and dialog titles' },
  { token: '--by-text-2xl', label: '2xl — empty-state headlines' },
  { token: '--by-text-3xl', label: '3xl — the wordmark' },
];

const SPACE_SCALE: readonly { token: string; label: string }[] = [
  { token: '--by-space-1', label: '1' },
  { token: '--by-space-2', label: '2' },
  { token: '--by-space-3', label: '3' },
  { token: '--by-space-4', label: '4' },
  { token: '--by-space-5', label: '5' },
  { token: '--by-space-6', label: '6' },
  { token: '--by-space-8', label: '8' },
  { token: '--by-space-10', label: '10' },
];

const RADIUS_SCALE: readonly { token: string; label: string }[] = [
  { token: '--by-radius-sm', label: 'sm — tiles, tags, swatches' },
  { token: '--by-radius-md', label: 'md — panels, cards, wells' },
  { token: '--by-radius-lg', label: 'lg — dialogs, floating groups' },
  { token: '--by-radius-pill', label: 'pill — buttons, inputs, chips' },
];

function TypeRow({ token, label }: { token: string; label: string }) {
  const size = useToken(token);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--by-space-4)', marginBottom: 'var(--by-space-2)' }}>
      <div
        style={{ width: 220, fontFamily: 'var(--by-font-mono)', fontSize: 'var(--by-text-xs)', color: 'var(--by-text-faint)' }}
      >
        {token} · {size || '—'}
      </div>
      <div style={{ fontSize: `var(${token})`, fontFamily: 'var(--by-font-ui)' }}>{label}</div>
    </div>
  );
}

function SpaceBar({ token, label }: { token: string; label: string }) {
  const size = useToken(token);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--by-space-3)', marginBottom: 'var(--by-space-1)' }}>
      <div style={{ width: 56, fontFamily: 'var(--by-font-mono)', fontSize: 'var(--by-text-2xs)' }}>{label}</div>
      <div style={{ height: 14, width: `var(${token})`, background: 'var(--by-accent)', borderRadius: 2 }} />
      <div style={{ fontFamily: 'var(--by-font-mono)', fontSize: 'var(--by-text-2xs)', color: 'var(--by-text-faint)' }}>
        {size || '—'}
      </div>
    </div>
  );
}

function RadiusSwatch({ token, label }: { token: string; label: string }) {
  const value = useToken(token);
  return (
    <div style={{ width: 160 }}>
      <div
        style={{
          height: 72,
          width: 72,
          background: 'var(--by-panel-sunken)',
          border: '1px solid var(--by-line)',
          borderRadius: `var(${token})`,
        }}
      />
      <div style={{ marginTop: 'var(--by-space-1)', fontSize: 'var(--by-text-xs)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--by-font-mono)', fontSize: 'var(--by-text-2xs)', color: 'var(--by-text-faint)' }}>
        {token} · {value || '—'}
      </div>
    </div>
  );
}

function FoundationsPage() {
  return (
    <div style={{ color: 'var(--by-text)', maxWidth: 900 }}>
      <Section title="Colour roles">
        <Row>
          {SEMANTIC_COLOR_TOKENS.map((t) => (
            <ColorSwatch key={t.token} {...t} />
          ))}
        </Row>
      </Section>
      <Section title="Palette — neutral">
        <Row>
          {NEUTRAL_RAMP.map((t) => (
            <ColorSwatch key={t.token} {...t} />
          ))}
        </Row>
      </Section>
      <Section title="Palette — terracotta">
        <Row>
          {ACCENT_RAMP.map((t) => (
            <ColorSwatch key={t.token} {...t} />
          ))}
        </Row>
      </Section>
      <Section title="Palette — sage">
        <Row>
          {ACCENT_2_RAMP.map((t) => (
            <ColorSwatch key={t.token} {...t} />
          ))}
        </Row>
      </Section>
      <Section title="Type scale">
        {TYPE_SCALE.map((t) => (
          <TypeRow key={t.token} token={t.token} label={t.label} />
        ))}
      </Section>
      <Section title="Space">
        {SPACE_SCALE.map((t) => (
          <SpaceBar key={t.token} {...t} />
        ))}
      </Section>
      <Section title="Radii">
        <Row>
          {RADIUS_SCALE.map((t) => (
            <RadiusSwatch key={t.token} {...t} />
          ))}
        </Row>
      </Section>
    </div>
  );
}

const meta = {
  title: 'Foundations',
  component: FoundationsPage,
} satisfies Meta<typeof FoundationsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The whole token scale, read live from `tokens.css` — colour roles, ramps, type, space, radii. */
export const TokenScale: Story = {};
