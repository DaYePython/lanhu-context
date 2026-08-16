import {
  STAGE_DESIGN_MENU_MARKER,
  STAGE_TREE_CURRENT_SELECTOR,
  STAGE_TREE_ID_ATTR
} from './stage-selectors';

/**
 * Stage draws its design cards with fabric.js, so there is no per-card DOM to
 * hit-test and the right-click target lives only on a JS object. The left nav
 * tree is the one DOM mirror of the canvas selection: selecting an object puts
 * `.is-current` on its row, and that row's `node-id` is the design's image_id.
 *
 * This also covers the tree's own ⋯ button, which opens the very same menu.
 *
 * Returns null rather than guessing. A wrong id here would produce a link that
 * silently points at another design.
 */
export function readStageImageId(root: ParentNode): string | null {
  // Gate on the menu shape: the host only offers 分享设计图 when the target is a
  // design, so this rejects blank-area right-clicks.
  if (!root.querySelector(STAGE_DESIGN_MENU_MARKER)) return null;

  // The selector also demands `is-leafstate`, which keeps group rows — whose
  // node-id is a client-generated group uuid — out of the result.
  const rows = root.querySelectorAll(STAGE_TREE_CURRENT_SELECTOR);
  // 0 = nothing selected; >1 = multi-selection, where "the" design is ambiguous.
  if (rows.length !== 1) return null;

  const id = rows[0]?.getAttribute(STAGE_TREE_ID_ATTR)?.trim();
  return id ? id : null;
}
