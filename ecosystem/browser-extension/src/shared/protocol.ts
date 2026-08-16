/**
 * `pageCookie` carries the content script's own `document.cookie`. The service
 * worker cannot read it (no DOM), and chrome.cookies has been observed coming
 * back narrower than the page's own jar, so the two are merged before the
 * header is built.
 */
export type BackgroundMessage =
  | { type: 'copy-cookies'; pageCookie?: string }
  | { type: 'send-cookies'; pageCookie?: string };

export type BackgroundReply =
  | { ok: true; token?: string }
  | { ok: false; error: string };
