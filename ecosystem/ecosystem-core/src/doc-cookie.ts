import type { CookieLike } from './cookies';

/**
 * document.cookie already lists cookies in the browser's own precedence
 * order, so pairs are kept verbatim and in order (values may themselves
 * contain '='). Nameless fragments cannot round-trip through a Cookie
 * header and are dropped.
 */
export function parseDocumentCookie(raw: string): CookieLike[] {
  const cookies: CookieLike[] = [];
  for (const part of raw.split(';')) {
    const pair = part.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    cookies.push({ name: pair.slice(0, eq), value: pair.slice(eq + 1) });
  }
  return cookies;
}
