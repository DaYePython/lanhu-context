import { BRIDGE_PATH } from './constants';
import { type CookieLike, formatCookieHeader } from './cookies';

export interface CookieApi {
  getAll(details: { domain: string }): Promise<CookieLike[]>;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Whatever posts the payload: window.fetch, or a GM_xmlhttpRequest wrapper. */
export type BridgeFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{ ok: boolean; status?: number }>;

/**
 * The cookie source is injected per platform: the extension passes
 * chrome.cookies (matches subdomains and, unlike document.cookie, returns
 * HttpOnly entries), the userscript passes a GM_cookie adapter with a
 * document.cookie fallback.
 */
export async function collectCookieHeader(api: CookieApi): Promise<string> {
  const cookies = await api.getAll({ domain: 'lanhuapp.com' });
  const header = formatCookieHeader(cookies);
  if (!header) throw new Error('NO_COOKIES');
  return header;
}

/**
 * `extraHeaders` lets the userscript carry the `x-lanhu-bridge` marker the CLI
 * receiver accepts in place of a chrome-extension:// Origin, which
 * GM_xmlhttpRequest cannot produce.
 */
export async function sendCookieHeader(
  fetchFn: BridgeFetch,
  port: number,
  token: string,
  extraHeaders?: Record<string, string>
): Promise<SendResult> {
  try {
    const response = await fetchFn(`http://127.0.0.1:${port}${BRIDGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ lanhuToken: token })
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
