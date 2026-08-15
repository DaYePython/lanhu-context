import { describe, expect, it } from 'vitest';
import { formatCookieHeader, sortCookies } from '../cookies';

describe('formatCookieHeader', () => {
  it('joins name=value pairs with "; "', () => {
    expect(
      formatCookieHeader([
        { name: 'sid', value: 'FAKE1' },
        { name: 'uid', value: 'FAKE2' }
      ])
    ).toBe('sid=FAKE1; uid=FAKE2');
  });

  it('drops entries with an empty name', () => {
    expect(
      formatCookieHeader([
        { name: '', value: 'x' },
        { name: 'sid', value: 'FAKE1' }
      ])
    ).toBe('sid=FAKE1');
  });

  it('keeps cookies whose value is an empty string', () => {
    expect(formatCookieHeader([{ name: 'flag', value: '' }])).toBe('flag=');
  });

  it('returns an empty string for no cookies', () => {
    expect(formatCookieHeader([])).toBe('');
  });

  it('emits values verbatim without re-encoding', () => {
    expect(formatCookieHeader([{ name: 'a', value: 'x%20y' }])).toBe('a=x%20y');
  });
});

describe('sortCookies', () => {
  it('orders longer paths first, per RFC 6265 §5.4', () => {
    const sorted = sortCookies([
      { name: 'root', value: '1', path: '/' },
      { name: 'deep', value: '2', path: '/web/detail' },
      { name: 'mid', value: '3', path: '/web' }
    ]);
    expect(sorted.map((c) => c.name)).toEqual(['deep', 'mid', 'root']);
  });

  it('is stable for equal path lengths', () => {
    const sorted = sortCookies([
      { name: 'a', value: '1', path: '/x' },
      { name: 'b', value: '2', path: '/y' }
    ]);
    expect(sorted.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('treats a missing path as "/"', () => {
    const sorted = sortCookies([
      { name: 'none', value: '1' },
      { name: 'deep', value: '2', path: '/web' }
    ]);
    expect(sorted[0]?.name).toBe('deep');
  });

  it('does not mutate the input array', () => {
    const input = [
      { name: 'root', value: '1', path: '/' },
      { name: 'deep', value: '2', path: '/web' }
    ];
    sortCookies(input);
    expect(input[0]?.name).toBe('root');
  });
});
