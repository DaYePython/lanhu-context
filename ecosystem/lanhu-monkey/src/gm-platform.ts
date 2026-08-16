import {
  type BridgeFetch,
  type CookieHeaderResult,
  type CookieLike,
  collectCookieHeader,
  DEFAULT_BRIDGE_PORT,
  copyText as domCopyText,
  formatCookieHeader,
  type MenuPlatform,
  parseDocumentCookie,
  sendCookieHeader as postCookieHeader,
  type SendOutcome
} from '@lanhu-context/ecosystem-core';
import { GM_cookie, GM_setClipboard, GM_xmlhttpRequest } from '$';

const NO_COOKIE_ERROR = '未找到 lanhuapp.com 的 Cookie，请先登录';

/** Shown whenever only document.cookie was readable. */
const HTTP_ONLY_NOTE =
  '本次未含 HttpOnly Cookie（Tampermonkey 需在 设置 → Security → Allow scripts to access cookies 选 All）；若 lanhu auth test 失败请改用浏览器扩展';

function listGmCookies(domain: string): Promise<CookieLike[]> {
  return new Promise((resolve, reject) => {
    try {
      GM_cookie.list({ domain }, (cookies, error) => {
        if (error) reject(new Error(String(error)));
        else resolve((cookies ?? []) as CookieLike[]);
      });
    } catch (error) {
      // GM_cookie missing (manager without support / grant denied) lands here.
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * GM_cookie is the only userscript route to HttpOnly cookies, and it can be
 * absent (manager support) or denied (Tampermonkey security setting). Any
 * failure — including an empty list — degrades to document.cookie plus a
 * warning note; `lanhu auth test` is the definitive check either way.
 */
async function readCookieHeader(): Promise<CookieHeaderResult> {
  try {
    const token = await collectCookieHeader(
      { getAll: ({ domain }) => listGmCookies(domain) },
      parseDocumentCookie(document.cookie)
    );
    return { ok: true, token };
  } catch {
    // Fall through to the degraded path.
  }
  const header = formatCookieHeader(parseDocumentCookie(document.cookie));
  if (!header) return { ok: false, error: NO_COOKIE_ERROR };
  return { ok: true, token: header, note: HTTP_ONLY_NOTE };
}

/** Adapts GM_xmlhttpRequest to the fetch shape core's bridge helper expects. */
const gmFetch: BridgeFetch = (url, init) =>
  new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      method: 'POST',
      headers: init.headers,
      data: init.body,
      onload: response =>
        resolve({
          ok: response.status >= 200 && response.status < 300,
          status: response.status
        }),
      onerror: () =>
        reject(new Error('无法连接本机接收端（请先运行 lanhu auth listen）')),
      ontimeout: () => reject(new Error('连接本机接收端超时'))
    });
  });

async function sendCookieHeader(): Promise<SendOutcome> {
  const read = await readCookieHeader();
  if (!read.ok) return { ok: false, error: read.error };

  // The x-lanhu-bridge header is the userscript's admission ticket:
  // GM_xmlhttpRequest cannot present a chrome-extension:// Origin, and the
  // CLI receiver accepts this custom header instead (a web page cannot send
  // one without a CORS preflight it never passes).
  const result = await postCookieHeader(
    gmFetch,
    DEFAULT_BRIDGE_PORT,
    read.token,
    {
      'x-lanhu-bridge': 'lanhu-monkey'
    }
  );
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error ??
        `本机接收端返回 ${result.status}（请先运行 lanhu auth listen）`
    };
  }
  return read.note ? { ok: true, note: read.note } : { ok: true };
}

async function copyText(text: string): Promise<boolean> {
  try {
    GM_setClipboard(text, 'text');
    return true;
  } catch {
    return domCopyText(text);
  }
}

export const gmPlatform: MenuPlatform = {
  copyText,
  readCookieHeader,
  sendCookieHeader
};
