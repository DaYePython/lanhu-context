import type { BackgroundMessage, BackgroundReply } from '../shared/protocol';
import { buildDesignUrl, resolveDesignRef } from '../shared/url';
import { copyText } from './clipboard';
import { installMenuInjector, type MenuItemSpec } from './menu';

function toast(message: string): void {
  const el = document.createElement('div');
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

function ask(message: BackgroundMessage): Promise<BackgroundReply> {
  return chrome.runtime.sendMessage(message) as Promise<BackgroundReply>;
}

async function copyDesignUrl(): Promise<void> {
  // Content scripts share the page origin, so this is the same localStorage
  // lanhu itself falls back to when the url has no tid.
  const ref = resolveDesignRef(location.href, localStorage);
  if (!ref) {
    toast('未识别到设计稿参数（tid / pid / image_id 均无法获取）');
    return;
  }
  const ok = await copyText(buildDesignUrl(ref));
  toast(ok ? '已复制设计稿链接' : '复制失败，请检查剪贴板权限');
}

async function copyCookies(): Promise<void> {
  const reply = await ask({ type: 'copy-cookies' });
  if (!reply.ok) {
    toast(`获取 Cookie 失败：${reply.error}`);
    return;
  }
  if (!reply.token) {
    toast('获取 Cookie 失败：返回为空');
    return;
  }
  const ok = await copyText(reply.token);
  toast(ok ? '已复制 Cookie，可粘贴到 lanhu auth set' : '复制失败');
}

async function sendCookies(): Promise<void> {
  const reply = await ask({ type: 'send-cookies' });
  toast(
    reply.ok ? '已发送到本机 lanhu auth listen' : `发送失败：${reply.error}`
  );
}

const specs: MenuItemSpec[] = [
  {
    id: 'copy-design-url',
    label: '复制选中设计稿链接',
    badge: 'CLI',
    onSelect: () => void copyDesignUrl()
  },
  {
    id: 'copy-cookies',
    label: '复制 cookies',
    badge: 'CLI',
    onSelect: () => void copyCookies()
  },
  {
    id: 'send-cookies',
    label: '发送 cookies 到本机',
    badge: 'CLI',
    onSelect: () => void sendCookies()
  }
];

installMenuInjector(document.body, specs);
