import { describe, expect, it } from 'vitest';
import { parseDocumentCookie } from '../doc-cookie';

describe('parseDocumentCookie', () => {
  it('splits pairs and keeps their order', () => {
    expect(parseDocumentCookie('sid=FAKE1; uid=FAKE2')).toEqual([
      { name: 'sid', value: 'FAKE1' },
      { name: 'uid', value: 'FAKE2' }
    ]);
  });

  it('keeps "=" inside values verbatim', () => {
    expect(parseDocumentCookie('token=a=b=c')).toEqual([
      { name: 'token', value: 'a=b=c' }
    ]);
  });

  it('keeps empty values', () => {
    expect(parseDocumentCookie('flag=')).toEqual([{ name: 'flag', value: '' }]);
  });

  it('drops nameless fragments that cannot round-trip', () => {
    expect(parseDocumentCookie('orphan; =value; sid=FAKE')).toEqual([
      { name: 'sid', value: 'FAKE' }
    ]);
  });

  it('returns an empty list for an empty string', () => {
    expect(parseDocumentCookie('')).toEqual([]);
  });
});
