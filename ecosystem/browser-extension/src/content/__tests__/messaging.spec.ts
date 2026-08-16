import { afterEach, describe, expect, it, vi } from 'vitest';
import { ask } from '../messaging';

function stubSendMessage(impl: () => Promise<unknown>): void {
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(impl) } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ask', () => {
  it('passes the reply through untouched', async () => {
    stubSendMessage(async () => ({ ok: true, token: 'sid=FAKE' }));
    await expect(ask({ type: 'copy-cookies' })).resolves.toEqual({
      ok: true,
      token: 'sid=FAKE'
    });
  });

  it('turns an invalidated context into an actionable reply', async () => {
    // Reloading the extension without refreshing the tab kills this port; the
    // click must not die silently.
    stubSendMessage(async () => {
      throw new Error('Extension context invalidated.');
    });
    const reply = await ask({ type: 'copy-cookies' });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.error).toContain('刷新页面');
  });

  it('reports a missing receiver the same way', async () => {
    stubSendMessage(async () => {
      throw new Error(
        'Could not establish connection. Receiving end does not exist.'
      );
    });
    const reply = await ask({ type: 'send-cookies' });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.error).toContain('刷新页面');
  });

  it('surfaces any other failure verbatim', async () => {
    stubSendMessage(async () => {
      throw new Error('boom');
    });
    const reply = await ask({ type: 'send-cookies' });
    expect(reply).toEqual({ ok: false, error: 'boom' });
  });

  it('survives a synchronous throw', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: () => {
          throw new Error('Extension context invalidated.');
        }
      }
    });
    await expect(ask({ type: 'copy-cookies' })).resolves.toMatchObject({
      ok: false
    });
  });
});
