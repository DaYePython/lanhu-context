import { BRIDGE_PATH } from '../shared/constants';
import { type CookieLike, formatCookieHeader } from '../shared/cookies';

export interface CookieApi {
  getAll(details: { domain: string }): Promise<CookieLike[]>;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * chrome.cookies.getAll matches subdomains too, and unlike document.cookie it
 * returns HttpOnly entries — which is the whole reason this ships as an
 * extension rather than a userscript.
 */
export async function collectCookieHeader(api: CookieApi): Promise<string> {
  const cookies = await api.getAll({ domain: 'lanhuapp.com' });
  const header = formatCookieHeader(cookies);
  if (!header) throw new Error('NO_COOKIES');
  return header;
}

export async function sendCookieHeader(
  fetchFn: typeof fetch,
  port: number,
  token: string
): Promise<SendResult> {
  try {
    const response = await fetchFn(`http://127.0.0.1:${port}${BRIDGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
