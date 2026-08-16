export interface MenuItemSpec {
  id: string;
  label: string;
  onSelect: () => void;
  /** Optional right-aligned chip. Adapters may ignore it. */
  badge?: string;
}

/**
 * One host menu dialect. Lanhu renders a different context menu per page —
 * muse-ui on detailDetach, a plain `ul.operate-list` on stage — so the
 * injector knows only how to find a menu and delegate the markup.
 */
export interface MenuAdapter {
  /** Right-click menu root this adapter claims. */
  readonly dialogSelector: string;
  /** Item container inside that root. */
  readonly listSelector: string;
  /** Appends our rows, in this host's dialect. Owns any host-specific fixups. */
  insert(list: Element, specs: MenuItemSpec[]): void;
}

export const ITEM_ATTR = 'data-lanhu-ext-item';

export function injectInto(
  dialog: HTMLElement,
  specs: MenuItemSpec[],
  adapter: MenuAdapter
): boolean {
  const list = dialog.querySelector(adapter.listSelector);
  if (!list) return false;
  // Idempotence keys off our rows still being present, not a flag on the
  // dialog: a flag goes stale the moment the host re-renders its list and
  // drops them, and we would never put them back.
  if (list.querySelector(`[${ITEM_ATTR}]`)) return false;

  adapter.insert(list, specs);
  return true;
}

/**
 * Both menus are mounted and unmounted on every right-click, so the injector
 * has to observe rather than run once. Each batch triggers one coalesced
 * sweep: cheap, and it also recovers when a host re-render drops our rows.
 */
export function installMenuInjector(
  root: Element,
  specs: MenuItemSpec[],
  adapters: MenuAdapter[]
): () => void {
  let disposed = false;
  let scheduled = false;

  const sweep = (): void => {
    for (const adapter of adapters) {
      for (const dialog of root.querySelectorAll<HTMLElement>(
        adapter.dialogSelector
      )) {
        injectInto(dialog, specs, adapter);
      }
    }
  };

  const schedule = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!disposed) sweep();
    });
  };

  sweep();

  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });

  return () => {
    disposed = true;
    observer.disconnect();
  };
}
