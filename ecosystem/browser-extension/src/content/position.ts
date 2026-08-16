export interface MenuBox {
  top: number;
  height: number;
}

/**
 * The host picks the popover's top from `menuItem.length` alone, so the rows we
 * append are invisible to its flip-up decision. It is `position:fixed` with no
 * scrolling, so an underestimate means our rows are simply clipped away.
 *
 * Returns the corrected top, or null when no correction is needed.
 */
export function correctedTop(
  box: MenuBox,
  viewportHeight: number,
  margin = 8
): number | null {
  const overflow = box.top + box.height + margin - viewportHeight;
  if (overflow <= 0) return null;
  return Math.max(margin, box.top - overflow);
}
