/** DOM id for the bubble belonging to a given tooltip trigger id — shared by `TooltipHost`,
 * `useTooltip` and `useTooltipDelegate` so `aria-describedby` always points at the right node. */
export function tooltipDomId(id: string): string {
  return `by-tooltip-${id}`;
}
