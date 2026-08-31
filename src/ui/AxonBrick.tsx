/**
 * The chest's tile thumbnail. Per docs/DESIGN.md, hand-drawn axonometric brick geometry
 * is the only artwork in the system besides Lucide icons, and its three visible faces
 * are fixed hex steps of the accent ramps — the same treatment as `public/icon.svg` and
 * the tile examples in `design-language.html`, copied here rather than reinvented.
 *
 * This is a generic pictogram, not a per-part render: the chest is built against mock
 * data with no geometry available, so tone and stud count are a coarse hint (how many
 * studs the part's title implies, up to four) rather than an accurate model of the part.
 */

import type { BrickTone, StudCount } from './brickPictogram';

const TONES: Record<BrickTone, { left: string; right: string; top: string; hi: string }> = {
  clay: { left: '#b2622d', right: '#d67f48', top: '#f6a06b', hi: '#ffc6a5' },
  deepClay: { left: '#8c491a', right: '#b2622d', top: '#d67f48', hi: '#ffc6a5' },
  sage: { left: '#728157', right: '#8fa073', top: '#aebf92', hi: '#ccdbb2' },
  neutral: { left: '#645c50', right: '#82796a', top: '#a19786', hi: '#c0b6a5' },
};

interface AxonBrickProps {
  tone: BrickTone;
  studs: StudCount;
  /** Round parts (plates, bricks) get a turned-disc pictogram instead of a brick block. */
  round?: boolean;
  size?: number;
}

export function AxonBrick({ tone, studs, round = false, size = 52 }: AxonBrickProps) {
  const c = TONES[tone];

  if (round) {
    return (
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <circle cx="32" cy="32" r="13" fill="none" stroke={c.right} strokeWidth="5" />
        <circle cx="32" cy="32" r="5" fill={c.left} />
      </svg>
    );
  }

  if (studs === 1) {
    return (
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <g strokeLinejoin="round" strokeWidth={3}>
          <path d="M18 32 L32 40 L32 48 L18 40 Z" fill={c.left} stroke={c.left} />
          <path d="M46 32 L32 40 L32 48 L46 40 Z" fill={c.right} stroke={c.right} />
          <path d="M18 32 L32 24 L46 32 L32 40 Z" fill={c.top} stroke={c.top} />
        </g>
        <ellipse cx="32" cy="26.5" rx="3.4" ry="1.8" fill={c.hi} />
      </svg>
    );
  }

  if (studs === 2) {
    return (
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <g strokeLinejoin="round" strokeWidth={3}>
          <path d="M14 30 L32 39 L32 50 L14 41 Z" fill={c.left} stroke={c.left} />
          <path d="M50 30 L32 39 L32 50 L50 41 Z" fill={c.right} stroke={c.right} />
          <path d="M14 30 L32 21 L50 30 L32 39 Z" fill={c.top} stroke={c.top} />
        </g>
        <ellipse cx="32" cy="23.5" rx="4" ry="2.1" fill={c.hi} />
        <ellipse cx="32" cy="31.5" rx="4" ry="2.1" fill={c.hi} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <g strokeLinejoin="round" strokeWidth={3}>
        <path d="M10 26 L32 37 L32 52 L10 41 Z" fill={c.left} stroke={c.left} />
        <path d="M54 26 L32 37 L32 52 L54 41 Z" fill={c.right} stroke={c.right} />
        <path d="M10 26 L32 15 L54 26 L32 37 Z" fill={c.top} stroke={c.top} />
      </g>
      <ellipse cx="32" cy="20.5" rx="5" ry="2.6" fill={c.right} />
      <ellipse cx="32" cy="17.6" rx="5" ry="2.6" fill={c.hi} />
      <ellipse cx="21" cy="26" rx="5" ry="2.6" fill={c.right} />
      <ellipse cx="21" cy="23.1" rx="5" ry="2.6" fill={c.hi} />
      <ellipse cx="43" cy="26" rx="5" ry="2.6" fill={c.right} />
      <ellipse cx="43" cy="23.1" rx="5" ry="2.6" fill={c.hi} />
      <ellipse cx="32" cy="31.5" rx="5" ry="2.6" fill={c.right} />
      <ellipse cx="32" cy="28.6" rx="5" ry="2.6" fill={c.hi} />
    </svg>
  );
}
