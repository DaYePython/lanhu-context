import {
  BADGE_BOX_CLASS,
  BADGE_CLASS,
  DIALOG_SELECTOR,
  ITEM_CLASS,
  LIST_SELECTOR,
  RIPPLE_CLASS,
  TITLE_BOX_CLASS,
  TITLE_CLASS,
  WRAPPER_CLASS,
  WRAPPER_STYLE
} from './detail-selectors';
import type { MenuAdapter, MenuItemSpec } from './injector';

const ITEM_FLAG = 'lanhuExtItem';

/**
 * Rebuilds the host's row markup node for node (see docs/NOTES.md). muse-ui
 * styles key off this exact nesting, so a flatter approximation renders
 * unstyled:
 *
 *   div[data-lanhu-ext-item]
 *     div.mu-menu-item-wrapper
 *       div
 *         div.mu-ripple-wrapper
 *         div.mu-menu-item
 *           div.mu-menu-item-title > span.menu-item-title
 *           div > span.key-icon > span.hotkey
 */
export function buildDetailRow(spec: MenuItemSpec): HTMLElement {
  const row = document.createElement('div');
  row.dataset[ITEM_FLAG] = spec.id;

  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_CLASS;
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'menuitem');
  wrapper.setAttribute('style', WRAPPER_STYLE);

  const inner = document.createElement('div');

  const ripple = document.createElement('div');
  ripple.className = RIPPLE_CLASS;

  const item = document.createElement('div');
  item.className = ITEM_CLASS;

  const titleBox = document.createElement('div');
  titleBox.className = TITLE_BOX_CLASS;
  const title = document.createElement('span');
  title.className = TITLE_CLASS;
  title.textContent = spec.label;
  titleBox.append(title);

  const afterBox = document.createElement('div');
  if (spec.badge) {
    const keyIcon = document.createElement('span');
    keyIcon.className = BADGE_BOX_CLASS;
    const hotkey = document.createElement('span');
    hotkey.className = BADGE_CLASS;
    hotkey.textContent = spec.badge;
    keyIcon.append(hotkey);
    afterBox.append(keyIcon);
  }

  item.append(titleBox, afterBox);
  inner.append(ripple, item);
  wrapper.append(inner);
  row.append(wrapper);

  // Listeners sit on the row so clicks anywhere inside the nesting count.
  // The host closes its menu on a bubbling mouseup, which would tear the
  // popover down before click ever fires.
  row.addEventListener('mouseup', event => event.stopPropagation());
  row.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  row.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    spec.onSelect();
  });

  return row;
}

export const detailMenuAdapter: MenuAdapter = {
  dialogSelector: DIALOG_SELECTOR,
  listSelector: LIST_SELECTOR,
  insert(list, specs) {
    for (const spec of specs) list.append(buildDetailRow(spec));
  }
};
