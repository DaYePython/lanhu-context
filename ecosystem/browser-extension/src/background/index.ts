import {
  collectCookieHeader,
  DEFAULT_BRIDGE_PORT,
  parseDocumentCookie,
  sendCookieHeader
} from '@lanhu-context/ecosystem-core';
import type { BackgroundMessage, BackgroundReply } from '../shared/protocol';

async function handle(message: BackgroundMessage): Promise<BackgroundReply> {
  try {
    const token = await collectCookieHeader(
      chrome.cookies,
      parseDocumentCookie(message.pageCookie ?? '')
    );
    if (message.type === 'copy-cookies') return { ok: true, token };

    const result = await sendCookieHeader(fetch, DEFAULT_BRIDGE_PORT, token);
    if (result.ok) return { ok: true };
    return {
      ok: false,
      error:
        result.error ??
        `本机接收端返回 ${result.status}（请先运行 lanhu auth listen）`
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error:
        reason === 'NO_COOKIES'
          ? '未找到 lanhuapp.com 的 Cookie，请先登录'
          : reason
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message as BackgroundMessage).then(sendResponse);
  return true; // keep the message channel open for the async reply
});
