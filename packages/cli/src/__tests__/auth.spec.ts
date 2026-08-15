import { describe, expect, it } from 'vitest';
import { normalizeCookieToken } from '../commands/auth';

describe('normalizeCookieToken', () => {
  it('trims whitespace', () => {
    expect(normalizeCookieToken('  a=b; c=d  ')).toBe('a=b; c=d');
  });

  it('strips a leading Cookie: label (case-insensitive)', () => {
    expect(normalizeCookieToken('Cookie: a=b; c=d')).toBe('a=b; c=d');
    expect(normalizeCookieToken('cookie:a=b')).toBe('a=b');
  });

  it('strips surrounding quotes from shell-style pastes', () => {
    expect(normalizeCookieToken('"a=b; c=d"')).toBe('a=b; c=d');
    expect(normalizeCookieToken("'a=b'")).toBe('a=b');
  });

  it('leaves interior quotes and equals signs intact', () => {
    expect(normalizeCookieToken('a="b"; c=d')).toBe('a="b"; c=d');
  });

  it('returns empty string for blank input', () => {
    expect(normalizeCookieToken('   ')).toBe('');
  });
});
