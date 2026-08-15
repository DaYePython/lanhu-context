export type BackgroundMessage =
  | { type: 'copy-cookies' }
  | { type: 'send-cookies' };

export type BackgroundReply =
  | { ok: true; token?: string }
  | { ok: false; error: string };
