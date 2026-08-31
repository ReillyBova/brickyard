/**
 * Lucide icons, inlined at stroke-width 2.75 per docs/DESIGN.md. Path data is copied
 * verbatim from `design-language.html`'s reference render, which is itself checked
 * against lucide.dev — copy new icons from there rather than hand-drawing paths.
 */
import type { SVGProps } from 'react';

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="search" {...props}>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </Icon>
  );
}

/** The chest's category filter. */
export function FilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="list-filter" {...props}>
      <path d="M3 6h18" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </Icon>
  );
}

/** Disclosure chevron for the colour picker's finishes accordion; rotates via CSS. */
export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="chevron-down" {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

/** Light-theme toggle target: shown when the current theme is dark ("switch to light"). */
export function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="sun" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Icon>
  );
}

/** Dark-theme toggle target: shown when the current theme is light ("switch to dark"). */
export function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="moon" {...props}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Icon>
  );
}
