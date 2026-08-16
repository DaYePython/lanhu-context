// Measured on the live stage page (2026-08-16). See docs/NOTES.md for the
// captured output. Stage draws its design cards with fabric.js, so unlike
// detailDetach there is no per-card DOM — the left nav tree is the only DOM
// mirror of the canvas selection, and these selectors are the whole basis for
// reading it.

/** Popover root. Two different components render this same id; match the id. */
export const STAGE_DIALOG_SELECTOR = '#contextMenuWrap';

/**
 * Item container. Note `#contextMenuWrap` also holds `ul.menu-children` for
 * submenus — appending there would nest our rows inside a flyout.
 */
export const STAGE_LIST_SELECTOR = 'ul.operate-list';

/** Host CSS keys off this class for padding, hover and cursor. */
export const STAGE_ITEM_CLASS = 'operate-item';

/**
 * Prefix for our label class. Never reuse a host action name: `p.delete`
 * renders red and `p.active` is the submenu-open highlight.
 */
export const STAGE_LABEL_PREFIX = 'lanhu-ext-';

/**
 * Only a design right-click gets 分享设计图 in the menu — measured false on a
 * blank-area right-click. Its presence is our "the target is a design" gate.
 */
export const STAGE_DESIGN_MENU_MARKER = 'ul.operate-list p.shareImg';

/** Selected rows in the nav tree; `node-id` carries the design's image_id. */
export const STAGE_TREE_CURRENT_SELECTOR =
  '#navTreeRoot .l-tree-node.is-current.is-leafstate[node-id]';

/** ⚠ Not `node-layer` — that one is a tree-internal uuid, not an image id. */
export const STAGE_TREE_ID_ATTR = 'node-id';
