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

/** The restyle action: bulk semantic recolor. */
export function PaintbrushIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="paintbrush" {...props}>
      <path d="m14.622 17.897-10.68-2.913" />
      <path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z" />
      <path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15" />
    </Icon>
  );
}

/** A restyle row's "maps to" connector, from current color to replacement. */
export function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="arrow-right" {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Icon>
  );
}

/** Resets one restyle row back to its original color, and undoes a committed restyle. */
export function Undo2Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="undo-2" {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
    </Icon>
  );
}

/** Redoes a restyle after an undo. */
export function Redo2Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="redo-2" {...props}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
    </Icon>
  );
}

/** Closes a popover or panel. */
export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="x" {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}
