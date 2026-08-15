// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('copyText', () => {
  it('uses the async clipboard api when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the clipboard api rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });

    await expect(copyText('hello')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    // The scratch textarea must not be left in the page.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when both paths fail', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false)
    });
    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('survives a missing clipboard api entirely', async () => {
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(true)
    });
    await expect(copyText('hello')).resolves.toBe(true);
  });
});
