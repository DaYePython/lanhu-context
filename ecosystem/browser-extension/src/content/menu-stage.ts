import { ITEM_ATTR, type MenuAdapter, type MenuItemSpec } from './menu';
import { correctedTop } from './position';
import {
  STAGE_DIALOG_SELECTOR,
  STAGE_ITEM_CLASS,
  STAGE_LABEL_PREFIX,
  STAGE_LIST_SELECTOR
} from './stage-selectors';

/**
 * The host closes its menu from a bubbling document click whose target sits
 * outside the popover (ContextMenu.created), and clicking our own row never
 * qualifies — so the menu would stay open after an action.
 *
 * Removing #contextMenuWrap ourselves is NOT an option: Vue keeps `menuShow`
 * true, so the next right-click re-uses the now-detached node and the menu
 * never comes back.
 */
export function closeHostMenu(): void {
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * The stage menu is plain markup — `li.operate-item > p` — and the host styles
 * it with descendant selectors that ask only for those two, so a namespaced
 * class on the `p` keeps the font, padding and hover.
 */
export function buildStageRow(spec: MenuItemSpec): HTMLElement {
  const row = document.createElement('li');
  row.className = STAGE_ITEM_CLASS;
  row.setAttribute(ITEM_ATTR, spec.id);

  const label = document.createElement('p');
  label.className = `${STAGE_LABEL_PREFIX}${spec.id}`;
  label.textContent = spec.label;
  // The popover is a hard 184px and rows are a fixed 32px line box with no
  // nowrap of their own, so a wrapped label overlaps the row below it.
  label.style.whiteSpace = 'nowrap';
  label.style.overflow = 'hidden';
  label.style.textOverflow = 'ellipsis';
  row.append(label);

  row.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    spec.onSelect();
    closeHostMenu();
  });

  return row;
}

export function insertStageRows(list: Element, specs: MenuItemSpec[]): void {
  const hostLast = list.lastElementChild;
  const rows = specs.map(buildStageRow);

  // `.operate-item:last-child hr{display:none}` stops matching the host's last
  // row once ours follow it, so its own divider reappears and separates the
  // block for free. Only synthesize one when that row carries none.
  const first = rows[0];
  if (first && hostLast && !hostLast.querySelector('hr')) {
    first.prepend(document.createElement('hr'));
  }

  list.append(...rows);
  keepMenuInViewport(list.closest(STAGE_DIALOG_SELECTOR));
}

/**
 * Applied once, right after injection. Vue re-patches the popover's inline
 * style whenever a submenu opens, which reverts this — acceptable, since the
 * submenus belong to host actions we are not part of.
 */
function keepMenuInViewport(dialog: Element | null): void {
  if (!(dialog instanceof HTMLElement)) return;
  const box = dialog.getBoundingClientRect();
  // jsdom reports zeros; a zero-height box never overflows, so tests are inert.
  const top = correctedTop({ top: box.top, height: box.height }, innerHeight);
  if (top === null) return;
  dialog.style.top = `${top}px`;
  dialog.style.bottom = 'unset';
}

export const stageMenuAdapter: MenuAdapter = {
  dialogSelector: STAGE_DIALOG_SELECTOR,
  listSelector: STAGE_LIST_SELECTOR,
  insert: insertStageRows
};
