// Measured on the live detailDetach page (2026-08-16). See NOTES.md for the
// captured outerHTML. Lanhu renders its context menu with muse-ui, whose
// class names are build-dependent, so every selector here is recorded from
// the real DOM rather than inferred from source.

/** Popover root lanhu creates for each right-click. Also carries `mu-popover`. */
export const DIALOG_SELECTOR = '.detail_context_menu_dialog';

/**
 * The item container. Note this is `.mu-menu-list`, NOT `.mu-menu` — the
 * latter is an outer wrapper that also holds sizing styles.
 */
export const LIST_SELECTOR = '.mu-menu-list';

/** Innermost item node; used for counting/asserting, not for construction. */
export const ITEM_SELECTOR = '.mu-menu-item';

// --- Classes used when constructing an item, outermost to innermost ---------
// Real structure per entry:
//   div[data-*]                       <- our marker root
//     div.mu-menu-item-wrapper[tabindex=0][style]
//       div                            <- empty class in the host markup
//         div.mu-ripple-wrapper
//         div.mu-menu-item
//           div.mu-menu-item-title
//             span.menu-item-title     <- label text
//           div
//             span.key-icon
//               span.hotkey            <- badge text

export const WRAPPER_CLASS = 'mu-menu-item-wrapper';
export const RIPPLE_CLASS = 'mu-ripple-wrapper';
export const ITEM_CLASS = 'mu-menu-item';
export const TITLE_BOX_CLASS = 'mu-menu-item-title';
export const TITLE_CLASS = 'menu-item-title';
export const BADGE_BOX_CLASS = 'key-icon';
export const BADGE_CLASS = 'hotkey';

/** Copied verbatim from host items so injected rows stay clickable and inert. */
export const WRAPPER_STYLE =
  'user-select: none; outline: none; cursor: pointer; appearance: none;';
