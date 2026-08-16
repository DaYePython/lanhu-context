import { installMenuInjector, type MenuItemSpec } from './menu/injector';
import { detailMenuAdapter } from './menu/menu-detail';
import { stageMenuAdapter } from './menu/menu-stage';
import { readStageImageId } from './menu/stage-target';
import {
  buildDesignUrl,
  type DesignRefParts,
  resolveDesignRefParts
} from './url';

/**
 * What a host (extension content script or userscript) must supply. Everything
 * user-visible — menu items, wording, toasts — lives here so both platforms
 * stay in lockstep by construction.
 */
export interface MenuPlatform {
  copyText(text: string): Promise<boolean>;
  readCookieHeader(): Promise<CookieHeaderResult>;
  sendCookieHeader(): Promise<SendOutcome>;
}

export type CookieHeaderResult =
  | { ok: true; token: string; note?: string }
  | { ok: false; error: string };

export type SendOutcome =
  | { ok: true; note?: string }
  | { ok: false; error: string };

export const TOAST_ATTR = 'data-lanhu-ext-toast';

function toast(message: string): void {
  const el = document.createElement('div');
  el.setAttribute(TOAST_ATTR, '');
  el.textContent = message;
  el.style.cssText = [
    'position:fixed',
    'z-index:99999',
    'left:50%',
    'top:24px',
    'transform:translateX(-50%)',
    'padding:8px 16px',
    'border-radius:4px',
    'background:rgba(0,0,0,.82)',
    'color:#fff',
    'font-size:13px',
    'pointer-events:none'
  ].join(';');
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
}

const PARAM_LABELS: Record<keyof DesignRefParts, string> = {
  teamId: 'tid',
  projectId: 'pid',
  imageId: 'image_id'
};

async function copyDesignUrl(platform: MenuPlatform): Promise<void> {
  // Both hosts share the page origin, so this is the same localStorage lanhu
  // itself falls back to. On stage the url carries no image id at all —
  // readStageImageId digs the right-clicked design out of the nav tree, and
  // returns null on the detail page, where the url already has one.
  const parts = resolveDesignRefParts(
    location.href,
    localStorage,
    readStageImageId(document)
  );
  const missing = (
    Object.keys(PARAM_LABELS) as (keyof DesignRefParts)[]
  ).filter(key => !parts[key]);

  if (missing.length > 0) {
    toast(
      `未识别到设计稿参数：缺少 ${missing
        .map(key => PARAM_LABELS[key])
        .join(' / ')}`
    );
    return;
  }

  const url = buildDesignUrl({
    teamId: parts.teamId as string,
    projectId: parts.projectId as string,
    imageId: parts.imageId as string
  });
  const ok = await platform.copyText(url);
  toast(ok ? '已复制设计稿链接' : '复制失败，请检查剪贴板权限');
}

async function copyCookies(platform: MenuPlatform): Promise<void> {
  const result = await platform.readCookieHeader();
  if (!result.ok) {
    toast(`获取 Cookie 失败：${result.error}`);
    return;
  }
  const ok = await platform.copyText(result.token);
  if (!ok) {
    toast('复制失败');
    return;
  }
  const base = '已复制 Cookie，可粘贴到 lanhu auth set';
  toast(result.note ? `${base}；${result.note}` : base);
}

async function sendCookies(platform: MenuPlatform): Promise<void> {
  const result = await platform.sendCookieHeader();
  if (!result.ok) {
    toast(`发送失败：${result.error}`);
    return;
  }
  const base = '已发送到本机 lanhu auth listen';
  toast(result.note ? `${base}；${result.note}` : base);
}

/**
 * Installs the three lanhu-context menu items into both host menus (detail +
 * stage adapters are always active; each claims its own dialog by selector).
 * Returns the injector's dispose function.
 */
export function installLanhuContextMenu(
  root: Element,
  platform: MenuPlatform
): () => void {
  const specs: MenuItemSpec[] = [
    {
      id: 'copy-design-url',
      label: '复制选中设计稿链接',
      badge: 'CLI',
      onSelect: () => void copyDesignUrl(platform)
    },
    {
      id: 'copy-cookies',
      label: '复制 cookies',
      badge: 'CLI',
      onSelect: () => void copyCookies(platform)
    },
    {
      id: 'send-cookies',
      label: '发送 cookies 到本机',
      badge: 'CLI',
      onSelect: () => void sendCookies(platform)
    }
  ];

  return installMenuInjector(root, specs, [
    detailMenuAdapter,
    stageMenuAdapter
  ]);
}
