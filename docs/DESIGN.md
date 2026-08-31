# Design language

How BrickYard looks, and why. This is a working reference for anyone — person or agent — building
UI in this repository.

Two companions:

- [`src/styles/tokens.css`](../src/styles/tokens.css) — every colour, size, radius and duration.
- [`src/styles/components.css`](../src/styles/components.css) — the classes built on those tokens.
- `design-language.html` — the same thing rendered, in both themes. Open it in a browser.

Docs are state, not history: when a decision changes, edit the rule and delete what it replaced.

---

## The idea

A brick is a small, warm, over-rounded object that clicks. BrickYard's interface is made of the same
thing.

That gives the whole system its shape. Surfaces are rounded and warm, never grey and never sharp.
Controls are pills you press. Panels are rafts floating over the scene rather than walls boxing it
in. The heaviest, most saturated colour on screen belongs to the bricks — everything the app draws
around them stays a step quieter.

The other half of the idea is that this is a real editor with a large operation set: multi-select,
rotate about connection axes, group, mirror, recolour, isolate, undo across all of it. So the chrome
is disciplined. It's warm, not decorative; playful in its shapes, matter-of-fact in its words.

---

## Rules

The short list. If you only read one section, read this one.

1. **Never write a raw value.** No hexes, no font names, no px sizes that a token already carries. If
   the token doesn't exist, add it to `tokens.css` — don't inline it.
2. **Reference semantic tokens, not palette ramps.** Components use `--by-panel`, not
   `--color-neutral-800`. The theme switch re-points the semantic layer; anything reaching past it
   into the ramp breaks in dark mode.
3. **The bricks are the brightest thing on screen.** No chrome surface, tint or highlight may compete
   with the model for attention.
4. **Nothing sharp except the viewport.** The render canvas is square-cornered because rounding it
   would clip geometry. Everything else is rounded; anything pressable is a full pill.
5. **CSS never animates the render loop.** Ghosts, gizmos and camera motion live in `scene/` and are
   driven per frame. CSS transitions apply to chrome only.
6. **Every operation has a keyboard path, and the UI says what it is.** A control with a shortcut
   shows it in its tooltip.
7. **No spinners where we know the number.** Model import reports `0..1`; show the bar and the count.
8. **Theme with `data-theme` on `<html>`.** Never with a media query alone, and never per component.

---

## Theme

Two themes, one set of ramps read from opposite ends. Dark is the default.

```html
<html data-theme="dark">
```

Dark is default because the viewport dominates the window, and a dark ground is where brick colour
reads truest — a cream viewport washes out sand, tan and light grey parts, which are a large share of
the corpus. Light is offered because building on a bright ground is pleasant and because printed
instructions and screenshots want it.

|                | Light                 | Dark                     |
| -------------- | --------------------- | ------------------------ |
| Viewport       | `--by-canvas` sand    | `--by-canvas` near-black warm |
| Frame, toolbar | `--by-chrome` cream   | `--by-chrome` deep brown |
| Panels         | `--by-panel` cream    | `--by-panel` deep brown  |
| Wells, inputs  | `--by-panel-sunken`   | `--by-panel-sunken`      |
| Popovers       | `--by-popover` lighter | `--by-popover` lighter   |

Note the direction reversal: on light, popovers and dialogs get **lighter** than the panel beneath
them; on dark they also get lighter. Elevation always means "closer to the light", in both themes.

Elevation on dark is a hairline top edge plus ambient darkness. A soft drop shadow is invisible
there, so `--by-shadow-*` are themed rather than shared.

The scene reads its overlay colours (`--by-3d-*`) from computed style, so hover, selection and ghost
tints re-theme with the chrome instead of being hard-coded in `scene/`.

---

## Colour

Three ramps on one perceptual lightness scale, so step 400 of any role carries the same visual weight
as step 400 of any other.

- **Neutral** — warm sand through deep brown. There is no true grey in BrickYard.
- **Terracotta** (`--color-accent-*`) — the action colour. Primary buttons, selection, focus, the
  ghost, active tool. BrickYard's own clay.
- **Sage** (`--color-accent-2-*`) — the second voice, and a real one rather than a highlight. It
  means *structure*: connection points, "select connected", the graph, what's holding a piece up. If
  something is about how the model is held together, it's sage.

Two colour rules worth stating plainly:

**Terracotta on the cream ground clears 3:1, not 4.5:1.** That's enough for icons, large text and
interface chrome. For accent-coloured text at paragraph size use `--by-accent-text`, which is a deep
ramp step, not the base accent.

**The LDraw palette is data, and we don't reinterpret it.** A swatch shows the real LDraw RGB — which
means a swatch can be any colour, including ones that clash with the theme. So the selected ring is
drawn in the theme accent *outside* the swatch, never as a tint on it, and LDraw's finishes
(transparent, pearl, chrome) get a marker rather than a colour change.

---

## Typography

Two faces and a monospace, each with one job.

| Face             | Token                | Used for |
| ---------------- | -------------------- | -------- |
| **Grandstander** (700) | `--by-font-display` | The wordmark, panel titles, dialog titles, empty-state headlines, button labels |
| **Figtree**      | `--by-font-ui`       | Everything else — labels, body copy, metadata, menu items |
| **JetBrains Mono** | `--by-font-mono`   | Part ids, LDraw colour codes, LDU values, angles, counts, shortcuts |

Grandstander carries the display voice: playful but workmanlike — slightly flared stems, a real
lowercase g, an unusual choice for an editor and the better one for a tool made of toys. Two reasons
it beat the rounder, fatter candidates: it has a full weight axis, and the display face here has to
hold a 44px wordmark *and* a 13px button label; and it stays legible at 13px, which a chunkier face
does not. Titles and labels are 700 (`--by-font-display-weight`); never lighter than 600, and never
a paragraph.

Data is monospaced and tabular because it gets compared: `3001` next to `3003`, `-40.0` ticking to
`-45.0`. Numbers that shift width as they change read as unstable, and this tool shows a lot of
changing numbers.

The scale runs 10 → 40px in seven steps. The interface default is `--by-text-md` (13px). Uppercase
appears in exactly one place: `.by-eyebrow`, the section label inside a panel.

---

## Space and density

A 4px base at 1.10 density. Balanced: comfortable at a desk, still legible at 1280px, not a
touchscreen and not a CAD spreadsheet.

- Controls are **32px** (`--by-control-h`). In-row controls inside a dense list drop to 26px; the one
  primary action in a dialog rises to 40px.
- Nothing clickable is smaller than **32px** (`--by-hit-min`), including icon buttons, whose visual
  circle may be smaller than their hit box.
- Panel rails are **268px**. Panel padding is `--by-space-3`; only the part-tile grid goes tighter.
- Rounded shapes need air. When something feels cramped, add space before you add a line.

---

## Shape

A real brick has roughly a one-third corner fillet on its stud pitch. The UI keeps that feel.

| Token               | Value | For |
| ------------------- | ----- | --- |
| `--by-radius-sm`    | 8px   | Part tiles, tags, small thumbnails |
| `--by-radius-md`    | 16px  | Panels, cards, wells |
| `--by-radius-lg`    | 28px  | Dialogs, floating groups |
| `--by-radius-pill`  | 999px | Buttons, inputs, chips, segments, swatches |
| `--by-radius-none`  | 0     | The viewport, and nothing else |

Circles and soft shapes are welcome as structure — swatches, stud dots, tool rafts. Hairline-only
geometry is not: a border is the last resort after space and surface change have both been tried.

---

## Motion

Toy-like means one specific thing: a snap has a tiny overshoot, as though the piece were pulled the
last fraction of a millimetre by the connection rather than pushed there by software. That's
`--by-ease-snap`, and it belongs on the switch knob, the swatch hover, and the commit of a placement.

Everything else is fast and flat: 80ms for hover and press, 140ms for reveals, 220ms for dialogs and
mode changes.

Three things never animate:

- **The ghost between candidates.** Tab cuts to the next candidate instantly. A tween would read as
  lag on the one interaction that has to feel immediate.
- **The camera**, from CSS. It's damped per frame in `scene/`.
- **Anything at all** when `prefers-reduced-motion` is set — the tokens collapse to `0ms`.

---

## The viewport

The largest surface, and mostly not ours to decorate.

**Snapping is shown by snapping.** The ghost piece follows the cursor and locks to the mated
transform crisply, and that is the feedback. No mate-count badge, no floating candidate list, no
numeric readout hovering over the model. If the ghost lands where the user meant, a badge tells them
nothing; if it doesn't, a badge doesn't help. The work goes into the landing, not the label.

What the viewport does draw:

| State | Treatment |
| ----- | --------- |
| Hover | `--by-3d-hover` edge lift on the hovered brick only |
| Selected | `--by-3d-select` outline; multi-select outlines every member, no per-brick handles |
| Ghost | `--by-3d-ghost` at `--by-3d-ghost-alpha`, solid geometry, no wireframe |
| Invalid placement | `--by-3d-invalid` on the ghost; collision, not incompatibility |
| Connected set | `--by-3d-connected` (sage) when "select connected" or graph inspection is active |
| Baseplate | `--by-canvas-grid` at 20 LDU stud pitch, fading with distance |

Chrome floats over the viewport as rafts with a gutter to the window edge, so the scene reads as
continuous underneath rather than as a picture in a frame. The marquee is the one overlay drawn in
CSS (`.by-marquee`); everything else is scene geometry.

---

## Components

All in `components.css`. Use the class; don't restyle it per screen. A one-off override is a request
for a new variant, and the variant belongs in the sheet.

| Class | What it is |
| ----- | ---------- |
| `.by-btn` + `--primary` `--secondary` `--ghost` `--danger` `--lg` `--sm` `--block` | Actions |
| `.by-icon-btn`, `.by-tool-group` | Toolbar tools; related tools ride one pill raft |
| `.by-input`, `.by-search`, `.by-num`, `.by-field` | Text, chest search, numeric transform fields |
| `.by-seg` + `.by-seg__opt`, `.by-switch` | Mode choice (2–4 options); binary toggle |
| `.by-tag` + `--accent` `--structure` `--neutral` `--outline` | Small labels |
| `.by-panel` + `__head` `__title` `__body` `__foot` `__section` | The floating rail — chest, inspector |
| `.by-well`, `.by-row` | Sunken block; label-left/control-right property row |
| `.by-tile-grid`, `.by-tile` + `__thumb` `__label` | The chest's atom |
| `.by-swatch-grid`, `.by-swatch` + `--trans` `--metal` | LDraw colour picker |
| `.by-kbd`, `.by-kbd-set`, `.by-tooltip` | Shortcut display |
| `.by-statusbar` | Brick count, selection count, mode hint |
| `.by-progress` + `__fill` | Model import |
| `.by-empty` + `__title` `__body` | Empty baseplate, empty search, empty selection |
| `.by-dialog-backdrop`, `.by-dialog` | Modals |
| `.by-viewport`, `.by-marquee` | The canvas and its one CSS overlay |

Icons are [Lucide](https://lucide.dev) at **stroke-width 2.75** — rounder and heavier than default,
to sit with the display face. 18px in icon buttons, 16px inline in text buttons, 15px in field
adornments. Inline the SVG and leave `stroke` on `currentColor`. Every icon in the reference page
carries a `data-lucide` attribute naming its glyph, so it can be checked against lucide.dev; the
ones used so far are `mouse-pointer-2`, `plus`, `rotate-cw`, `flip-horizontal-2`, `undo-2`,
`redo-2`, `list-filter`, `search`, `eye` and `group`.

The **only** hand-drawn artwork in the system is the brick itself — the mark, the chest thumbnails
and the empty-state outline, which are axonometric brick geometry rather than icons. Don't mix in
another icon set, and don't draw a one-off glyph.

---

## Words

Warm and light. The register is a good toy, not a hobbyist CAD package and not a startup.

- **Say what happened, in the user's terms.** "Placed a 2×4 brick." Not "Transform committed."
- **Undo labels are the canonical name of every operation**, and tooltips reuse them verbatim. If undo
  says "Rotate assembly", the tooltip says "Rotate assembly".
- **Empty states name the next move and offer it.** "Nothing on the baseplate yet. Open the chest and
  pick a piece." No apology, no exclamation mark.
- **Errors say what failed and what still works.** An unannotated part loses snapping, not the model:
  "This piece has no connection data, so it'll place freely."
- **Sentence case everywhere.** No Title Case buttons, no ALL CAPS outside `.by-eyebrow`.
- **Count things in bricks and studs**, and show LDU only where LDU is what the user is editing.
- No emoji. No exclamation marks. The playfulness is in the shapes.

---

## Icon

`public/icon.svg` — a 2×2 brick in three-quarter view: the smallest object in the corpus that is
unmistakably a brick and still shows all four studs. Three steps of the terracotta ramp for the three
visible faces, two more for the studs, and a rounded silhouette from stroking each face in its own
fill.

`public/favicon.svg` is the same mark on a cream tile at 86% so it survives 16px.

The lockup is the mark with **BrickYard** in Grandstander at 700, mark height equal to cap height, gap of
`--by-space-3`. Don't outline or recolour the mark per context — it has one colourway.

**The name is written BrickYard, with a capital Y.** One word, two capitals, no space and no hyphen.
Lowercasing the Y makes it read as "bricky-ard", which is the whole reason for the capital. This
holds in running prose as well as in the wordmark; the only exceptions are code identifiers and the
repository name, which stay lowercase.

---

## Accessibility

- Focus is always visible: `2px solid var(--by-accent)` at 2px offset. Never suppressed, never left
  as the browser default blue.
- Every icon button carries an accessible name; the tooltip is not the name.
- The full operation set is reachable by keyboard. Camera control is too — the mouse hand is often
  holding the camera, so a keyboard-only path is not a fallback here, it's a real mode.
- Text under 15px never carries the base accent as its colour; use `--by-accent-text`.
- `prefers-reduced-motion` collapses every chrome transition and disables the snap overshoot.

---

## Not specified here, on purpose

Snap candidate scoring, ghost behaviour and camera feel are product decisions, not style ones. They
live in `src/snap/resolve.ts` and `src/scene/interaction/`, and they are judged by using the tool.
This document can tell you what colour the ghost is. It cannot tell you whether the ghost landed
where someone meant.
