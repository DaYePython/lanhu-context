import {
  copyText,
  installLanhuContextMenu,
  type MenuPlatform
} from '@lanhu-context/ecosystem-core';
import { ask } from './messaging';

// All user-facing behaviour (menu items, wording, toasts) lives in
// ecosystem-core; this file only adapts the extension's message channel. The
// cookie work itself happens in the service worker — chrome.cookies is not
// available to content scripts — but document.cookie is only readable here, so
// it rides along and the worker merges both sources.
const platform: MenuPlatform = {
  copyText,
  async readCookieHeader() {
    const reply = await ask({
      type: 'copy-cookies',
      pageCookie: document.cookie
    });
    if (!reply.ok) return { ok: false, error: reply.error };
    if (!reply.token) return { ok: false, error: '返回为空' };
    return { ok: true, token: reply.token };
  },
  async sendCookieHeader() {
    const reply = await ask({
      type: 'send-cookies',
      pageCookie: document.cookie
    });
    return reply.ok ? { ok: true } : { ok: false, error: reply.error };
  }
};

installLanhuContextMenu(document.body, platform);
