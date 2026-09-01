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

/** Checked state inside a multi-select filter menu item. */
export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="check" {...props}>
      <path d="M20 6 9 17l-5-5" />
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

/** Toolbar: undo. */
export function UndoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="undo-2" {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
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

/** Toolbar: redo. */
export function RedoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="redo-2" {...props}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13" />
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

/**
 * Toolbar: group and ungroup both. `design-language.html`'s reference render reuses
 * this same glyph for its "Ungroup" example rather than introducing a second one —
 * followed here for consistency; the two actions are told apart by label and state,
 * not by icon.
 */
export function GroupIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="group" {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect width="7" height="5" x="7" y="7" rx="1" />
      <rect width="7" height="5" x="10" y="12" rx="1" />
    </Icon>
  );
}

/**
 * Toolbar mode switch: editor. A stack of distinct blocks reads as direct manipulation
 * of pieces — the thing every other mode is a view *onto*.
 */
export function EditorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="blocks" {...props}>
      <path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" />
      <rect x="14" y="2" width="8" height="8" rx="1" />
    </Icon>
  );
}

/**
 * Toolbar mode switch: graph. Same glyph as `src/features/graph/icons.tsx`'s
 * `GraphIcon` (its own doc comment: "three connected nodes reads literally as 'the
 * connection graph'") — lifted rather than re-derived so the mode option and that
 * feature's own entry point read as the same idea.
 */
export function GraphModeIcon(props: SVGProps<SVGSVGElement>) {
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

/** Toolbar: save the document to a `.json` file. */
export function SaveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="save" {...props}>
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </Icon>
  );
}

/** Toolbar: browse and load a bundled model without leaving the editor. */
export function PackageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="package" {...props}>
      <path d="M16.5 9.4 7.55 4.24" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </Icon>
  );
}

/** Toolbar: open a previously saved `.json` document. */
export function FolderOpenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="folder-open" {...props}>
      <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </Icon>
  );
}

/** Toolbar: export the model as `.ldr`, for Studio, LeoCAD or LDView. */
export function FileDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="file-down" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 18v-6" />
      <path d="m9 15 3 3 3-3" />
    </Icon>
  );
}

/** Toolbar: import a `.ldr`/`.mpd` model. */
export function FileUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="file-up" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 12v6" />
      <path d="m9 15 3-3 3 3" />
    </Icon>
  );
}

/**
 * Toolbar mode switch: render. `src/features/pathtrace/PathtraceToggle.tsx` already
 * inlines this exact glyph for the same action — lifted from there rather than
 * re-derived, per the coordinator's direction, so the control the user has already seen
 * is the one they click here too.
 */
export function ApertureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon data-lucide="aperture" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m14.31 8 5.74 9.94" />
      <path d="M9.69 8h11.48" />
      <path d="m7.38 12 5.74-9.94" />
      <path d="M9.69 16 3.95 6.06" />
      <path d="M14.31 16H2.83" />
      <path d="m16.62 12-5.74 9.94" />
    </Icon>
  );
}

/** Lucide `trash-2`. Clearing the baseplate. */
export function Trash2Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-lucide="trash-2"
      {...props}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}
