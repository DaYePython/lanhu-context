// One-shot loopback receiver for the browser extension's "发送 cookies 到本机".
//
// Threat model: any web page can POST cross-origin to 127.0.0.1 — CORS only
// blocks *reading* the reply, not sending the request. Browsers refuse to let
// pages forge `Origin`, so requiring a chrome-extension:// origin is what
// actually keeps a drive-by page from writing junk into the user's config.
// Loopback-only binding, single-shot acceptance and a hard timeout bound the
// exposure further.

import { createServer } from 'node:http';
import { LanhuError } from '@lanhu-context/core';

const MAX_BODY_BYTES = 64 * 1024;

export interface BridgePayload {
  lanhuToken: string;
  ddsToken?: string;
}

export interface ReceiveTokenOptions {
  port: number;
  host?: string;
  timeoutMs: number;
  /** Receives the bound port; needed when `port` is 0 (tests). */
  onListening?: (port: number) => void;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  return typeof origin === 'string' && origin.startsWith('chrome-extension://');
}

export function parseBridgeBody(raw: string): BridgePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LanhuError('USAGE_ERROR', 'Bridge payload is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LanhuError('USAGE_ERROR', 'Bridge payload must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  const lanhuToken = record.lanhuToken;
  if (typeof lanhuToken !== 'string' || !lanhuToken.includes('=')) {
    throw new LanhuError(
      'USAGE_ERROR',
      'Bridge payload must carry lanhuToken as a Cookie header value'
    );
  }

  const ddsToken = record.ddsToken;
  return {
    lanhuToken,
    ...(typeof ddsToken === 'string' && ddsToken ? { ddsToken } : {})
  };
}

export function receiveToken(
  options: ReceiveTokenOptions
): Promise<BridgePayload> {
  const host = options.host ?? '127.0.0.1';

  return new Promise<BridgePayload>((resolve, reject) => {
    let settled = false;

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => settle());
    };

    const server = createServer((req, res) => {
      const origin = req.headers.origin;
      const cors: Record<string, string> = isAllowedOrigin(origin)
        ? {
            'access-control-allow-origin': origin as string,
            'access-control-allow-headers': 'content-type',
            'access-control-allow-methods': 'POST, OPTIONS',
            vary: 'Origin'
          }
        : {};

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (req.method !== 'POST' || !req.url?.startsWith('/token')) {
        res.writeHead(404, cors);
        res.end();
        return;
      }
      if (!isAllowedOrigin(origin)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'origin not allowed' }));
        return;
      }

      let body = '';
      let aborted = false;
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413, cors);
          res.end();
          req.destroy();
        }
      });
      req.on('end', () => {
        if (aborted) return;
        let payload: BridgePayload;
        try {
          payload = parseBridgeBody(body);
        } catch {
          // Keep listening: one malformed post should not strand the user.
          res.writeHead(400, { ...cors, 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid payload' }));
          return;
        }
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        finish(() => resolve(payload));
      });
    });

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new LanhuError(
            'TOKEN_MISSING',
            '等待浏览器扩展发送 Cookie 超时，未写入任何凭据',
            {
              hint: '在蓝湖页面右键点击「发送 cookies 到本机」，或改用 `lanhu auth set`'
            }
          )
        )
      );
    }, options.timeoutMs);
    timer.unref?.();

    server.on('error', error => {
      finish(() =>
        reject(
          new LanhuError(
            'IO_WRITE_FAILED',
            `无法在 ${host}:${options.port} 上监听：${error.message}`,
            {
              cause: error,
              hint: '换一个端口：`lanhu auth listen --port 7624`'
            }
          )
        )
      );
    });

    server.listen(options.port, host, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        options.onListening?.(address.port);
      }
    });
  });
}
