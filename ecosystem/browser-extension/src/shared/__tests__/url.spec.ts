import { parseLanhuUrl } from '@lanhu-context/core';
import { describe, expect, it } from 'vitest';
import { buildDesignUrl, parseDesignRefFromHash } from '../url';

const HREF =
  'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T1&pid=P1&image_id=I1';

describe('parseDesignRefFromHash', () => {
  it('reads tid/pid/image_id from the hash fragment', () => {
    expect(parseDesignRefFromHash(HREF)).toEqual({
      teamId: 'T1',
      projectId: 'P1',
      imageId: 'I1'
    });
  });

  it('accepts the project_id and docId aliases', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T2&project_id=P2&docId=D2';
    expect(parseDesignRefFromHash(href)).toEqual({
      teamId: 'T2',
      projectId: 'P2',
      imageId: 'D2'
    });
  });

  it('prefers pid over project_id when lanhu sends both', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T&project_id=OLD&pid=NEW&image_id=I';
    expect(parseDesignRefFromHash(href)?.projectId).toBe('NEW');
  });

  it('ignores the search string before the hash', () => {
    const href =
      'https://lanhuapp.com/web/?from=share#/item/project/detailDetach?tid=T3&pid=P3&image_id=I3';
    expect(parseDesignRefFromHash(href)?.teamId).toBe('T3');
  });

  it('ignores extra params lanhu appends', () => {
    const href = `${HREF}&comment_id=C1&version_id=V1`;
    expect(parseDesignRefFromHash(href)).toEqual({
      teamId: 'T1',
      projectId: 'P1',
      imageId: 'I1'
    });
  });

  it('returns null when a required param is missing', () => {
    expect(
      parseDesignRefFromHash(
        'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T1&pid=P1'
      )
    ).toBeNull();
  });

  it('returns null when there is no hash query at all', () => {
    expect(
      parseDesignRefFromHash('https://lanhuapp.com/web/#/item')
    ).toBeNull();
    expect(parseDesignRefFromHash('https://lanhuapp.com/web/')).toBeNull();
  });
});

describe('buildDesignUrl', () => {
  const ref = { teamId: 'T1', projectId: 'P1', imageId: 'I1' };

  it('builds a canonical detailDetach url', () => {
    expect(buildDesignUrl(ref)).toBe(
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T1&pid=P1&image_id=I1'
    );
  });

  it('round-trips through the CLI parser', () => {
    const parsed = parseLanhuUrl(buildDesignUrl(ref));
    expect(parsed.teamId).toBe('T1');
    expect(parsed.projectId).toBe('P1');
    expect(parsed.docId).toBe('I1');
  });

  it('round-trips a url parsed straight off the address bar', () => {
    const ref2 = parseDesignRefFromHash(`${HREF}&comment_id=C1`);
    expect(ref2).not.toBeNull();
    const parsed = parseLanhuUrl(buildDesignUrl(ref2!));
    expect(parsed.docId).toBe('I1');
  });

  it('percent-encodes ids that contain url-unsafe characters', () => {
    const url = buildDesignUrl({ ...ref, imageId: 'a b&c' });
    expect(url).toContain('image_id=a+b%26c');
  });
});
