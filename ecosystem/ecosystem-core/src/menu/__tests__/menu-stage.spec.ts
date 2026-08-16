// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { injectInto } from '../injector';
import { buildStageRow, stageMenuAdapter } from '../menu-stage';
import { STAGE_ITEM_CLASS, STAGE_LABEL_PREFIX } from '../stage-selectors';

const specs = [
  { id: 'copy-design-url', label: '复制选中设计稿链接', onSelect: vi.fn() },
  { id: 'copy-cookies', label: '复制 cookies', onSelect: vi.fn() },
  { id: 'send-cookies', label: '发送 cookies 到本机', onSelect: vi.fn() }
];

/**
 * Verbatim host markup captured in docs/NOTES.md, trimmed of the hotkey svgs.
 * `delete` is the real last row and carries no <hr>; `menu-children` is the
 * submenu container that must never receive our rows.
 */
function makeMenu(lastRowHasDivider = false): HTMLElement {
  const wrap = document.createElement('div');
  wrap.id = 'contextMenuWrap';
  wrap.innerHTML = `
    <ul class="operate-list">
      <li class="operate-item"><p class="rename"> 重命名</p><hr></li>
      <li class="operate-item"><p class="shareImg"> 分享设计图</p></li>
      <li class="operate-item"><p class="delete"> 删除</p>${
        lastRowHasDivider ? '<hr>' : ''
      }</li>
    </ul>
    <ul class="menu-children"><li class="menu-child"><p>新建分组</p></li></ul>`;
  return wrap;
}

const HOST_ROWS = 3;

function ourRows(root: ParentNode): Element[] {
  return [...root.querySelectorAll('[data-lanhu-ext-item]')];
}

beforeEach(() => {
  document.body.innerHTML = '';
  for (const spec of specs) spec.onSelect.mockClear();
});

describe('buildStageRow', () => {
  it('reproduces the host row shape: li.operate-item > p', () => {
    const row = buildStageRow(specs[0]!);
    expect(row.tagName).toBe('LI');
    // Host CSS keys off this class for padding, hover and cursor.
    expect(row.classList.contains(STAGE_ITEM_CLASS)).toBe(true);
    expect(row.firstElementChild?.tagName).toBe('P');
  });

  it('renders the label text into the p', () => {
    const row = buildStageRow(specs[0]!);
    expect(row.querySelector('p')?.textContent).toBe('复制选中设计稿链接');
  });

  it('namespaces the label class away from host action names', () => {
    const row = buildStageRow(specs[0]!);
    const className = row.querySelector('p')!.className;
    expect(className).toBe(`${STAGE_LABEL_PREFIX}copy-design-url`);
    // p.delete renders red, p.active is the submenu highlight.
    expect(className).not.toBe('delete');
    expect(className).not.toBe('active');
  });

  it('marks the row with the extension namespace', () => {
    const row = buildStageRow(specs[0]!);
    expect(row.getAttribute('data-lanhu-ext-item')).toBe('copy-design-url');
  });

  it('pins the label to one line: the menu is a hard 184px', () => {
    const row = buildStageRow(specs[0]!);
    const label = row.querySelector('p') as HTMLElement;
    expect(label.style.whiteSpace).toBe('nowrap');
    expect(label.style.textOverflow).toBe('ellipsis');
  });

  it('ignores badge — the host row has no text badge slot', () => {
    const row = buildStageRow({ ...specs[0]!, badge: 'CLI' });
    expect(row.textContent).toBe('复制选中设计稿链接');
  });

  it('invokes onSelect on click', () => {
    const row = buildStageRow(specs[0]!);
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(specs[0]!.onSelect).toHaveBeenCalledOnce();
  });

  it('invokes onSelect when the click lands on the inner label', () => {
    const row = buildStageRow(specs[0]!);
    document.body.append(row);
    row
      .querySelector('p')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(specs[0]!.onSelect).toHaveBeenCalledOnce();
  });

  it('closes the host menu after running the action', () => {
    const wrap = makeMenu();
    document.body.append(wrap);
    const row = buildStageRow(specs[0]!);
    wrap.querySelector('ul.operate-list')!.append(row);

    const seen: EventTarget[] = [];
    document.addEventListener('click', event => {
      if (event.target) seen.push(event.target);
    });
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // The host closes on a document click whose target is outside the popover.
    expect(seen.some(target => !wrap.contains(target as Node))).toBe(true);
  });
});

describe('stageMenuAdapter', () => {
  it('appends every spec into ul.operate-list', () => {
    const wrap = makeMenu();
    expect(injectInto(wrap, specs, stageMenuAdapter)).toBe(true);
    expect(
      wrap.querySelectorAll('ul.operate-list > li.operate-item')
    ).toHaveLength(HOST_ROWS + specs.length);
  });

  it('never touches the submenu list', () => {
    const wrap = makeMenu();
    injectInto(wrap, specs, stageMenuAdapter);
    expect(ourRows(wrap.querySelector('ul.menu-children')!)).toHaveLength(0);
  });

  it('leaves the host rows untouched', () => {
    const wrap = makeMenu();
    injectInto(wrap, specs, stageMenuAdapter);
    const labels = [
      ...wrap.querySelectorAll('ul.operate-list > li.operate-item > p')
    ].map(p => p.textContent?.trim());
    expect(labels.slice(0, HOST_ROWS)).toEqual([
      '重命名',
      '分享设计图',
      '删除'
    ]);
  });

  it('adds a divider above our block when the host last row has none', () => {
    const wrap = makeMenu(false);
    injectInto(wrap, specs, stageMenuAdapter);
    const rows = ourRows(wrap);
    expect(rows[0]?.firstElementChild?.tagName).toBe('HR');
    expect(rows[1]?.querySelector('hr')).toBeNull();
  });

  it('reuses the host divider that appending un-hides', () => {
    // `.operate-item:last-child hr{display:none}` stops applying to the host's
    // last row once ours follow it, so a second divider would double up.
    const wrap = makeMenu(true);
    injectInto(wrap, specs, stageMenuAdapter);
    expect(ourRows(wrap)[0]?.querySelector('hr')).toBeNull();
  });

  it('is idempotent for a menu it already touched', () => {
    const wrap = makeMenu();
    injectInto(wrap, specs, stageMenuAdapter);
    expect(injectInto(wrap, specs, stageMenuAdapter)).toBe(false);
    expect(ourRows(wrap)).toHaveLength(specs.length);
  });

  it('returns false when the operate list is missing', () => {
    const wrap = document.createElement('div');
    wrap.id = 'contextMenuWrap';
    expect(injectInto(wrap, specs, stageMenuAdapter)).toBe(false);
  });
});
