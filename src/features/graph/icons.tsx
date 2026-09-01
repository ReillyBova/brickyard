/**
 * Lucide icons at stroke-width 2.75, per `docs/DESIGN.md` — the same convention
 * `src/ui/icons.tsx` follows, duplicated locally rather than imported since this slice
 * doesn't own `src/ui/`. Path data copied verbatim from lucide.dev.
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

/**
 * Three connected nodes reads literally as "the connection graph" — for the toolbar's
 * `graph` mode option once the mode switch is wired (see `index.ts`); not used
 * standalone any more now that the floating entry button is gone.
 */
export function GraphIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="share-2" {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
      <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </Icon>
  );
}

/** The explode/reassemble toggle, when the model is assembled — "hit to blow it apart". */
export function ExplodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="expand" {...props}>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </Icon>
  );
}

/** The explode/reassemble toggle, when the model is exploded — "hit to bring it back". */
export function AssembleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="shrink" {...props}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </Icon>
  );
}
