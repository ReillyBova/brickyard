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

/** Disclosure chevron for the colour picker's finishes accordion; rotates via CSS. */
export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="chevron-down" {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}
