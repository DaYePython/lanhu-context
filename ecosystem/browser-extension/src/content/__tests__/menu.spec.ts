// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { injectInto, installMenuInjector } from '../menu';
import { buildDetailRow, detailMenuAdapter } from '../menu-detail';
import {
  BADGE_CLASS,
  ITEM_SELECTOR,
  RIPPLE_CLASS,
  TITLE_BOX_CLASS,
  TITLE_CLASS,
  WRAPPER_CLASS
} from '../selectors';

const specs = [
  { id: 'copy-design-url', label: '复制选中设计稿链接', onSelect: vi.fn() },
  { id: 'copy-cookies', label: '复制 cookies', onSelect: vi.fn() },
  { id: 'send-cookies', label: '发送 cookies 到本机', onSelect: vi.fn() }
];

/**
 * Verbatim host markup captured in docs/NOTES.md: popover > .mu-menu >
 * .mu-menu-list > one native row ("返回"), plus a row injected by the
 * third-party helper that was present during recon.
 */
function makeDialog(): HTMLElement {
  const dialog = document.createElement('div');
  dialog.className = 'mu-popover detail_context_menu_dialog';
  dialog.innerHTML = `
    <div tabindex="0" class="mu-menu" style="width: 200px;">
      <div class="mu-menu-list" style="width: 200px;">
        <!---->
        <div data-lanhu-helper-copy-link="1">
          <div class="mu-menu-item-wrapper" tabindex="0" data-lanhu-helper-copy-link="1">
            <div class="">
              <div class="mu-ripple-wrapper"></div>
              <div class="mu-menu-item">
                <div class="mu-menu-item-title"><span class="menu-item-title">复制选中图层链接</span></div>
                <div><span class="key-icon"><span class="hotkey">⚡MCP</span></span></div>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div class="mu-menu-item-wrapper" tabindex="0">
            <div class="">
              <div class="mu-ripple-wrapper"></div>
              <div class="mu-menu-item">
                <div class="mu-menu-item-title"><span class="menu-item-title">返回</span></div>
                <div><span class="key-icon"><span class="hotkey">esc</span></span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  return dialog;
}

const HOST_ITEMS = 2; // the third-party row plus 返回

function itemCount(root: ParentNode): number {
  return root.querySelectorAll(ITEM_SELECTOR).length;
}

beforeEach(() => {
  document.body.innerHTML = '';
  for (const spec of specs) spec.onSelect.mockClear();
});

describe('buildDetailRow', () => {
  it('reproduces the host row nesting exactly', () => {
    const row = buildDetailRow(specs[0]!);
    const wrapper = row.firstElementChild as HTMLElement;
    expect(wrapper.className).toBe(WRAPPER_CLASS);
    expect(wrapper.getAttribute('tabindex')).toBe('0');

    const inner = wrapper.firstElementChild as HTMLElement;
    expect(inner.firstElementChild?.className).toBe(RIPPLE_CLASS);

    const item = inner.querySelector(ITEM_SELECTOR);
    expect(item).not.toBeNull();
    // The title lives one level below .mu-menu-item, not directly inside it.
    expect(item?.firstElementChild?.className).toBe(TITLE_BOX_CLASS);
  });

  it('renders the label into the title span', () => {
    const row = buildDetailRow(specs[0]!);
    expect(row.querySelector(`.${TITLE_CLASS}`)?.textContent).toBe(
      '复制选中设计稿链接'
    );
  });

  it('renders a badge when one is supplied', () => {
    const row = buildDetailRow({ ...specs[0]!, badge: 'CLI' });
    expect(row.querySelector(`.${BADGE_CLASS}`)?.textContent).toBe('CLI');
  });

  it('leaves the trailing slot empty when no badge is supplied', () => {
    const row = buildDetailRow(specs[0]!);
    expect(row.querySelector(`.${BADGE_CLASS}`)).toBeNull();
  });

  it('namespaces its marker away from the third-party injector', () => {
    const row = buildDetailRow(specs[0]!);
    expect(row.dataset.lanhuExtItem).toBe('copy-design-url');
    expect(row.hasAttribute('data-lanhu-helper-copy-link')).toBe(false);
  });

  it('invokes onSelect on click', () => {
    const row = buildDetailRow(specs[0]!);
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(specs[0]!.onSelect).toHaveBeenCalledOnce();
  });

  it('invokes onSelect when the click lands on the inner title span', () => {
    const row = buildDetailRow(specs[0]!);
    document.body.append(row);
    row
      .querySelector(`.${TITLE_CLASS}`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(specs[0]!.onSelect).toHaveBeenCalledOnce();
  });

  it('stops mouseup from bubbling so lanhu does not close the menu first', () => {
    const row = buildDetailRow(specs[0]!);
    document.body.append(row);
    const onBodyMouseUp = vi.fn();
    document.body.addEventListener('mouseup', onBodyMouseUp);
    row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(onBodyMouseUp).not.toHaveBeenCalled();
  });

  it('stops contextmenu from re-triggering the host handler', () => {
    const row = buildDetailRow(specs[0]!);
    document.body.append(row);
    const onBodyContextMenu = vi.fn();
    document.body.addEventListener('contextmenu', onBodyContextMenu);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(onBodyContextMenu).not.toHaveBeenCalled();
  });
});

describe('injectInto', () => {
  it('appends every spec into .mu-menu-list', () => {
    const dialog = makeDialog();
    expect(injectInto(dialog, specs, detailMenuAdapter)).toBe(true);
    expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length);
    expect(dialog.querySelector('.mu-menu-list')?.children).toHaveLength(
      HOST_ITEMS + specs.length
    );
  });

  it('leaves the host rows untouched', () => {
    const dialog = makeDialog();
    injectInto(dialog, specs, detailMenuAdapter);
    const titles = [...dialog.querySelectorAll(`.${TITLE_CLASS}`)].map(
      e => e.textContent
    );
    expect(titles.slice(0, HOST_ITEMS)).toEqual(['复制选中图层链接', '返回']);
  });

  it('is idempotent for a dialog it already touched', () => {
    const dialog = makeDialog();
    injectInto(dialog, specs, detailMenuAdapter);
    expect(injectInto(dialog, specs, detailMenuAdapter)).toBe(false);
    expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length);
  });

  it('returns false when the menu list is missing', () => {
    const dialog = document.createElement('div');
    dialog.className = 'detail_context_menu_dialog';
    expect(injectInto(dialog, specs, detailMenuAdapter)).toBe(false);
  });

  it('does not append to .mu-menu when .mu-menu-list is absent', () => {
    const dialog = document.createElement('div');
    dialog.className = 'detail_context_menu_dialog';
    dialog.innerHTML = '<div class="mu-menu"></div>';
    expect(injectInto(dialog, specs, detailMenuAdapter)).toBe(false);
    expect(itemCount(dialog)).toBe(0);
  });
});

describe('installMenuInjector', () => {
  it('injects into dialogs added after install', async () => {
    const dispose = installMenuInjector(document.body, specs, [detailMenuAdapter]);
    const dialog = makeDialog();
    document.body.append(dialog);

    await vi.waitFor(() =>
      expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length)
    );
    dispose();
  });

  it('injects into a dialog nested inside an added subtree', async () => {
    const dispose = installMenuInjector(document.body, specs, [detailMenuAdapter]);
    const wrapper = document.createElement('div');
    wrapper.append(makeDialog());
    document.body.append(wrapper);

    await vi.waitFor(() =>
      expect(itemCount(wrapper)).toBe(HOST_ITEMS + specs.length)
    );
    dispose();
  });

  it('re-injects when lanhu rebuilds the menu on the next right-click', async () => {
    const dispose = installMenuInjector(document.body, specs, [detailMenuAdapter]);
    const first = makeDialog();
    document.body.append(first);
    await vi.waitFor(() =>
      expect(itemCount(first)).toBe(HOST_ITEMS + specs.length)
    );

    first.remove();
    const second = makeDialog();
    document.body.append(second);
    await vi.waitFor(() =>
      expect(itemCount(second)).toBe(HOST_ITEMS + specs.length)
    );
    dispose();
  });

  it('stops injecting after dispose', async () => {
    const dispose = installMenuInjector(document.body, specs, [detailMenuAdapter]);
    dispose();
    const dialog = makeDialog();
    document.body.append(dialog);

    await new Promise(resolve => setTimeout(resolve, 30));
    expect(itemCount(dialog)).toBe(HOST_ITEMS);
  });

  it('re-injects when the host re-renders the list and drops our rows', async () => {
    const dispose = installMenuInjector(document.body, specs, [
      detailMenuAdapter
    ]);
    const dialog = makeDialog();
    document.body.append(dialog);
    await vi.waitFor(() =>
      expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length)
    );

    // A stale dataset flag on the dialog would make this unrecoverable.
    for (const row of dialog.querySelectorAll('[data-lanhu-ext-item]')) {
      row.remove();
    }
    dialog.querySelector('.mu-menu-list')!.append(document.createElement('div'));

    await vi.waitFor(() =>
      expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length)
    );
    dispose();
  });
});
