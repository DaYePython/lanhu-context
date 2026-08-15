export interface CookieLike {
  name: string;
  value: string;
  path?: string;
}

/**
 * Browsers send longer-path cookies first (RFC 6265 §5.4). chrome.cookies
 * exposes no creation time, so path length is the only ordering signal we can
 * reproduce; Array.prototype.sort is stable, which preserves enumeration
 * order for ties.
 */
export function sortCookies(cookies: CookieLike[]): CookieLike[] {
  return [...cookies].sort(
    (a, b) => (b.path ?? '/').length - (a.path ?? '/').length
  );
}

/**
 * Serializes to a Cookie request-header value. Values are emitted verbatim:
 * chrome.cookies already returns them in transport form, so encoding here
 * would corrupt the credential.
 */
export function formatCookieHeader(cookies: CookieLike[]): string {
  return sortCookies(cookies)
    .filter((cookie) => cookie.name.length > 0)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}
