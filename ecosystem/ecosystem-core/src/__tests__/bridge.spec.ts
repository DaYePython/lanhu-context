import { describe, expect, it, vi } from 'vitest';
import { collectCookieHeader, sendCookieHeader } from '../bridge';

describe('collectCookieHeader', () => {
  it('queries the lanhuapp.com domain and serializes the result', async () => {
    const getAll = vi.fn().mockResolvedValue([
      { name: 'sid', value: 'FAKE1', path: '/' },
      { name: 'uid', value: 'FAKE2', path: '/web' }
    ]);
    await expect(collectCookieHeader({ getAll })).resolves.toBe(
      'uid=FAKE2; sid=FAKE1'
    );
    expect(getAll).toHaveBeenCalledWith({ domain: 'lanhuapp.com' });
  });

  it('throws NO_COOKIES when the browser has none', async () => {
    const getAll = vi.fn().mockResolvedValue([]);
    await expect(collectCookieHeader({ getAll })).rejects.toThrow('NO_COOKIES');
  });

  it('merges in page cookies the privileged query missed', async () => {
    // Observed in the wild: chrome.cookies returned only PASSPORT while the
    // page's own jar held the rest of the session.
    const getAll = vi
      .fn()
      .mockResolvedValue([{ name: 'PASSPORT', value: 'FAKE1', path: '/' }]);
    await expect(
      collectCookieHeader({ getAll }, [
        { name: 'sid', value: 'FAKE2' },
        { name: 'uid', value: 'FAKE3' }
      ])
    ).resolves.toBe('PASSPORT=FAKE1; sid=FAKE2; uid=FAKE3');
  });

  it('still yields a header when only the page has cookies', async () => {
    const getAll = vi.fn().mockResolvedValue([]);
    await expect(
      collectCookieHeader({ getAll }, [{ name: 'sid', value: 'FAKE' }])
    ).resolves.toBe('sid=FAKE');
  });
});

describe('sendCookieHeader', () => {
  it('posts json to the local receiver', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await sendCookieHeader(fetchFn, 7623, 'sid=FAKE1');

    expect(result).toEqual({ ok: true, status: 200 });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:7623/token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      lanhuToken: 'sid=FAKE1'
    });
  });

  it('passes extra headers through for the userscript bridge marker', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await sendCookieHeader(fetchFn, 7623, 'sid=FAKE1', {
      'x-lanhu-bridge': 'lanhu-monkey'
    });

    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-lanhu-bridge': 'lanhu-monkey'
    });
  });

  it('reports a non-2xx status as a failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    const result = await sendCookieHeader(fetchFn, 7623, 'sid=FAKE1');
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it('turns a connection refusal into a readable error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await sendCookieHeader(fetchFn, 7623, 'sid=FAKE1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Failed to fetch');
  });
});
