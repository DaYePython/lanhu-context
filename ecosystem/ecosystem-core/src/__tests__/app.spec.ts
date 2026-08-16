// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLanhuContextMenu, type MenuPlatform, TOAST_ATTR } from '../app';

/** Minimal detail-page dialog: the adapter only needs root + list. */
function makeDetailDialog(): HTMLElement {
  const dialog = document.createElement('div');
  dialog.className = 'mu-popover detail_context_menu_dialog';
  dialog.innerHTML =
    '<div class="mu-menu"><div class="mu-menu-list"></div></div>';
  return dialog;
}

function ourRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-lanhu-ext-item]')];
}

function lastToast(): string | null {
  const toasts = document.querySelectorAll(`[${TOAST_ATTR}]`);
  const last = toasts[toasts.length - 1];
  return last ? last.textContent : null;
}

function platformStub(overrides: Partial<MenuPlatform> = {}): MenuPlatform {
  return {
    copyText: vi.fn().mockResolvedValue(true),
    readCookieHeader: vi
      .fn()
      .mockResolvedValue({ ok: true, token: 'sid=FAKE' }),
    sendCookieHeader: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides
  };
}

let dispose: (() => void) | null = null;

async function installAndOpen(platform: MenuPlatform): Promise<void> {
  dispose = installLanhuContextMenu(document.body, platform);
  document.body.append(makeDetailDialog());
  await vi.waitFor(() => expect(ourRows()).toHaveLength(3));
}

function click(id: string): void {
  document
    .querySelector(`[data-lanhu-ext-item="${id}"]`)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  location.hash = '';
});

afterEach(() => {
  dispose?.();
  dispose = null;
});

describe('installLanhuContextMenu', () => {
  it('injects the three shared items, each carrying the CLI badge', async () => {
    await installAndOpen(platformStub());
    expect(ourRows().map(row => row.dataset.lanhuExtItem)).toEqual([
      'copy-design-url',
      'copy-cookies',
      'send-cookies'
    ]);
    const badges = [...document.querySelectorAll('.hotkey')].map(
      el => el.textContent
    );
    expect(badges).toEqual(['CLI', 'CLI', 'CLI']);
  });

  it('names the exact missing params when the page has none', async () => {
    const platform = platformStub();
    await installAndOpen(platform);
    click('copy-design-url');
    await vi.waitFor(() =>
      expect(lastToast()).toBe('未识别到设计稿参数：缺少 tid / pid / image_id')
    );
    expect(platform.copyText).not.toHaveBeenCalled();
  });

  it('copies the canonical url when the hash carries all ids', async () => {
    const platform = platformStub();
    await installAndOpen(platform);
    location.hash = '#/item/project/detailDetach?tid=T1&pid=P1&image_id=I1';

    click('copy-design-url');
    await vi.waitFor(() => expect(lastToast()).toBe('已复制设计稿链接'));
    expect(platform.copyText).toHaveBeenCalledWith(
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T1&pid=P1&project_id=P1&image_id=I1'
    );
  });

  it('copies the cookie header and appends the platform note', async () => {
    const platform = platformStub({
      readCookieHeader: vi.fn().mockResolvedValue({
        ok: true,
        token: 'sid=FAKE',
        note: '仅含非 HttpOnly Cookie'
      })
    });
    await installAndOpen(platform);

    click('copy-cookies');
    await vi.waitFor(() =>
      expect(lastToast()).toBe(
        '已复制 Cookie，可粘贴到 lanhu auth set；仅含非 HttpOnly Cookie'
      )
    );
    expect(platform.copyText).toHaveBeenCalledWith('sid=FAKE');
  });

  it('surfaces a cookie read failure verbatim', async () => {
    await installAndOpen(
      platformStub({
        readCookieHeader: vi
          .fn()
          .mockResolvedValue({ ok: false, error: '未找到 Cookie' })
      })
    );
    click('copy-cookies');
    await vi.waitFor(() =>
      expect(lastToast()).toBe('获取 Cookie 失败：未找到 Cookie')
    );
  });

  it('reports a successful send', async () => {
    await installAndOpen(platformStub());
    click('send-cookies');
    await vi.waitFor(() =>
      expect(lastToast()).toBe('已发送到本机 lanhu auth listen')
    );
  });

  it('reports a failed send with the platform error', async () => {
    await installAndOpen(
      platformStub({
        sendCookieHeader: vi
          .fn()
          .mockResolvedValue({ ok: false, error: '连接被拒绝' })
      })
    );
    click('send-cookies');
    await vi.waitFor(() => expect(lastToast()).toBe('发送失败：连接被拒绝'));
  });
});
