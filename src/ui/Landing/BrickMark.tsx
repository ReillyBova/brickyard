/**
 * The landing hero: `public/icon.svg`'s geometry, redrawn inline (so its colours are
 * theme-independent token references rather than a static asset's baked hex, and so
 * its pieces can be targeted individually for the settle-in animation) at the same
 * three-quarter 2x2 brick per docs/DESIGN.md's Icon section. One colourway, matching
 * the shipped mark exactly — this is a restyle of *how it appears*, never a recolour.
 */
export function BrickMark() {
  return (
    <svg
      className="by-landing-mark"
      viewBox="0 0 64 64"
      width="64"
      height="64"
      role="img"
      aria-label="BrickYard"
    >
      <g strokeLinejoin="round" strokeLinecap="round" strokeWidth={3}>
        <path
          className="by-landing-mark__face"
          d="M10 26 L32 37 L32 52 L10 41 Z"
          fill="var(--color-accent-600)"
          stroke="var(--color-accent-600)"
        />
        <path
          className="by-landing-mark__face"
          d="M54 26 L32 37 L32 52 L54 41 Z"
          fill="var(--color-accent-500)"
          stroke="var(--color-accent-500)"
        />
        <path
          className="by-landing-mark__face"
          d="M10 26 L32 15 L54 26 L32 37 Z"
          fill="var(--color-accent-400)"
          stroke="var(--color-accent-400)"
        />
      </g>
      <g className="by-landing-mark__studs">
        <ellipse className="by-landing-mark__stud" cx="32" cy="20.5" rx="5" ry="2.6" fill="var(--color-accent-500)" />
        <ellipse className="by-landing-mark__stud by-landing-mark__hi" cx="32" cy="17.6" rx="5" ry="2.6" fill="var(--color-accent-300)" />
        <ellipse className="by-landing-mark__stud" cx="21" cy="26" rx="5" ry="2.6" fill="var(--color-accent-500)" />
        <ellipse className="by-landing-mark__stud by-landing-mark__hi" cx="21" cy="23.1" rx="5" ry="2.6" fill="var(--color-accent-300)" />
        <ellipse className="by-landing-mark__stud" cx="43" cy="26" rx="5" ry="2.6" fill="var(--color-accent-500)" />
        <ellipse className="by-landing-mark__stud by-landing-mark__hi" cx="43" cy="23.1" rx="5" ry="2.6" fill="var(--color-accent-300)" />
        <ellipse className="by-landing-mark__stud" cx="32" cy="31.5" rx="5" ry="2.6" fill="var(--color-accent-500)" />
        <ellipse className="by-landing-mark__stud by-landing-mark__hi" cx="32" cy="28.6" rx="5" ry="2.6" fill="var(--color-accent-300)" />
      </g>
    </svg>
  );
}
