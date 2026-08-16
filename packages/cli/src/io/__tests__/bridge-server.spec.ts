import { describe, expect, it } from 'vitest';
import {
  BRIDGE_MARKER_HEADER,
  type BridgePayload,
  isAllowedOrigin,
  isAllowedRequest,
  parseBridgeBody,
  receiveToken
} from '../bridge-server';

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

function post(port: number, body: string, origin: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body
  });
}

/**
 * Starts a receiver on an ephemeral port, hands the port to `run`, then
 * resolves with the payload the receiver accepted (await flattens the
 * inner promise).
 */
async function withServer(
  run: (port: number) => Promise<void>
): Promise<BridgePayload> {
  let resolvePort!: (port: number) => void;
  const portReady = new Promise<number>(resolve => {
    resolvePort = resolve;
  });
  const received = receiveToken({
    port: 0,
    timeoutMs: 5_000,
    onListening: resolvePort
  });
  await run(await portReady);
  return received;
}

describe('isAllowedOrigin', () => {
  it('accepts a chrome extension origin', () => {
    expect(isAllowedOrigin(EXT_ORIGIN)).toBe(true);
  });

  it('rejects web page origins and a missing header', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:7623')).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });
});

describe('isAllowedRequest', () => {
  it('admits an extension origin without the marker header', () => {
    expect(isAllowedRequest(EXT_ORIGIN, undefined)).toBe(true);
  });

  it('admits a userscript marker without any origin', () => {
    // GM_xmlhttpRequest cannot produce an extension Origin; the custom header
    // is its gate. A page cannot send one without a preflight it never passes.
    expect(isAllowedRequest(undefined, 'lanhu-monkey')).toBe(true);
  });

  it('admits the marker even alongside a page origin', () => {
    // Some userscript engines forward the page Origin on GM requests.
    expect(isAllowedRequest('https://lanhuapp.com', 'lanhu-monkey')).toBe(true);
  });

  it('rejects a page origin with a missing or blank marker', () => {
    expect(isAllowedRequest('https://evil.example', undefined)).toBe(false);
    expect(isAllowedRequest('https://evil.example', '   ')).toBe(false);
    expect(isAllowedRequest(undefined, undefined)).toBe(false);
  });
});

describe('parseBridgeBody', () => {
  it('accepts a payload carrying lanhuToken', () => {
    expect(parseBridgeBody('{"lanhuToken":"sid=FAKE"}')).toEqual({
      lanhuToken: 'sid=FAKE'
    });
  });

  it('keeps an optional ddsToken', () => {
    expect(
      parseBridgeBody('{"lanhuToken":"sid=FAKE","ddsToken":"dds=FAKE"}')
    ).toEqual({ lanhuToken: 'sid=FAKE', ddsToken: 'dds=FAKE' });
  });

  it('rejects malformed json', () => {
    expect(() => parseBridgeBody('not json')).toThrow();
  });

  it('rejects a payload without lanhuToken', () => {
    expect(() => parseBridgeBody('{"foo":1}')).toThrow();
  });

  it('rejects a token that is not a cookie pair', () => {
    expect(() => parseBridgeBody('{"lanhuToken":"nocookie"}')).toThrow();
  });
});

describe('receiveToken', () => {
  it('accepts one POST from an extension origin and resolves', async () => {
    const received = await withServer(async port => {
      const response = await post(
        port,
        JSON.stringify({ lanhuToken: 'sid=FAKE' }),
        EXT_ORIGIN
      );
      expect(response.status).toBe(200);
    });
    expect(received).toEqual({ lanhuToken: 'sid=FAKE' });
  });

  it('accepts a userscript POST carrying the marker header and no origin', async () => {
    const received = await withServer(async port => {
      const response = await fetch(`http://127.0.0.1:${port}/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [BRIDGE_MARKER_HEADER]: 'lanhu-monkey'
        },
        body: JSON.stringify({ lanhuToken: 'sid=FAKE' })
      });
      expect(response.status).toBe(200);
    });
    expect(received).toEqual({ lanhuToken: 'sid=FAKE' });
  });

  it('answers the CORS preflight', async () => {
    const received = await withServer(async port => {
      const preflight = await fetch(`http://127.0.0.1:${port}/token`, {
        method: 'OPTIONS',
        headers: { origin: EXT_ORIGIN }
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(
        EXT_ORIGIN
      );
      await post(port, JSON.stringify({ lanhuToken: 'sid=FAKE' }), EXT_ORIGIN);
    });
    expect(received).toEqual({ lanhuToken: 'sid=FAKE' });
  });

  it('rejects a POST from a web page origin with 403 and keeps listening', async () => {
    const received = await withServer(async port => {
      const denied = await post(
        port,
        JSON.stringify({ lanhuToken: 'sid=EVIL' }),
        'https://evil.example'
      );
      expect(denied.status).toBe(403);
      await post(port, JSON.stringify({ lanhuToken: 'sid=FAKE' }), EXT_ORIGIN);
    });
    expect(received).toEqual({ lanhuToken: 'sid=FAKE' });
  });

  it('rejects a bad payload with 400 and keeps listening', async () => {
    const received = await withServer(async port => {
      const bad = await post(port, '{"foo":1}', EXT_ORIGIN);
      expect(bad.status).toBe(400);
      await post(port, JSON.stringify({ lanhuToken: 'sid=FAKE' }), EXT_ORIGIN);
    });
    expect(received).toEqual({ lanhuToken: 'sid=FAKE' });
  });

  it('rejects with TOKEN_MISSING after the timeout', async () => {
    await expect(
      receiveToken({ port: 0, timeoutMs: 60 })
    ).rejects.toMatchObject({ code: 'TOKEN_MISSING' });
  });
});
