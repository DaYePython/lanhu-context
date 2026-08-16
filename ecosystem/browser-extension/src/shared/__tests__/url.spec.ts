import { parseLanhuUrl } from '@lanhu-context/core';
import { describe, expect, it } from 'vitest';
import {
  buildDesignUrl,
  parseHashParams,
  resolveDesignRef,
  resolveDesignRefParts,
  type StorageLike
} from '../url';

const FULL =
  'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T1&pid=P1&image_id=I1';

/** URL shape after lanhu's changeUrlQuery drops tid on a design switch. */
const SWITCHED =
  'https://lanhuapp.com/web/#/item/project/detailDetach?pid=P1&project_id=P1&image_id=I2';

function store(map: Record<string, string>): StorageLike {
  return { getItem: key => map[key] ?? null };
}

const EMPTY = store({});

describe('parseHashParams', () => {
  it('reads the query that follows the hash', () => {
    expect(parseHashParams(FULL)?.get('tid')).toBe('T1');
  });

  it('ignores the search string before the hash', () => {
    const href =
      'https://lanhuapp.com/web/?from=share#/item/project/detailDetach?tid=T3';
    expect(parseHashParams(href)?.get('tid')).toBe('T3');
  });

  it('returns null when there is no hash query', () => {
    expect(parseHashParams('https://lanhuapp.com/web/#/item')).toBeNull();
    expect(parseHashParams('https://lanhuapp.com/web/')).toBeNull();
  });
});

describe('resolveDesignRef', () => {
  it('reads everything from the url when tid is present', () => {
    expect(resolveDesignRef(FULL, EMPTY)).toEqual({
      teamId: 'T1',
      projectId: 'P1',
      imageId: 'I1'
    });
  });

  it('falls back to localStorage team_id after a design switch drops tid', () => {
    expect(resolveDesignRef(SWITCHED, store({ team_id: 'T9' }))).toEqual({
      teamId: 'T9',
      projectId: 'P1',
      imageId: 'I2'
    });
  });

  it('falls back to localStorage pid when the url carries neither pid alias', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?image_id=I1';
    expect(resolveDesignRef(href, store({ team_id: 'T9', pid: 'P9' }))).toEqual(
      {
        teamId: 'T9',
        projectId: 'P9',
        imageId: 'I1'
      }
    );
  });

  it('prefers the url over storage for teamId', () => {
    expect(resolveDesignRef(FULL, store({ team_id: 'STALE' }))?.teamId).toBe(
      'T1'
    );
  });

  it('accepts the team_id url alias as well as tid', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?team_id=T5&pid=P1&image_id=I1';
    expect(resolveDesignRef(href, EMPTY)?.teamId).toBe('T5');
  });

  it('accepts the project_id and docId aliases', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T2&project_id=P2&docId=D2';
    expect(resolveDesignRef(href, EMPTY)).toEqual({
      teamId: 'T2',
      projectId: 'P2',
      imageId: 'D2'
    });
  });

  it('prefers pid over project_id when lanhu sends both', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T&project_id=OLD&pid=NEW&image_id=I';
    expect(resolveDesignRef(href, EMPTY)?.projectId).toBe('NEW');
  });

  it('treats the literal string "undefined" in storage as absent', () => {
    // common/utils/tip-team.js writes localStorage.team_id = "undefined".
    expect(
      resolveDesignRef(SWITCHED, store({ team_id: 'undefined' }))
    ).toBeNull();
  });

  it('treats an empty stored value as absent', () => {
    // item/api/account-project.js writes localStorage.pid = "".
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?image_id=I1';
    expect(
      resolveDesignRef(href, store({ team_id: 'T9', pid: '' }))
    ).toBeNull();
  });

  it('never falls back to storage for imageId', () => {
    // A stale stored image_id would silently copy the wrong design.
    const href = 'https://lanhuapp.com/web/#/item/project/detailDetach?pid=P1';
    expect(
      resolveDesignRef(href, store({ team_id: 'T9', image_id: 'STALE' }))
    ).toBeNull();
  });

  it('ignores extra params lanhu appends', () => {
    const href = `${FULL}&comment_id=C1&version_id=V1`;
    expect(resolveDesignRef(href, EMPTY)).toEqual({
      teamId: 'T1',
      projectId: 'P1',
      imageId: 'I1'
    });
  });

  it('returns null when there is no hash query at all', () => {
    expect(
      resolveDesignRef('https://lanhuapp.com/web/', store({ team_id: 'T9' }))
    ).toBeNull();
  });

  it('survives a storage accessor that throws', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      }
    };
    expect(resolveDesignRef(FULL, hostile)?.teamId).toBe('T1');
    expect(resolveDesignRef(SWITCHED, hostile)).toBeNull();
  });
});

describe('buildDesignUrl', () => {
  const ref = { teamId: 'T1', projectId: 'P1', imageId: 'I1' };

  it('builds a canonical detailDetach url', () => {
    // project_id rides along because the detail page seeds `project.id` from
    // it; with only pid that field starts out undefined. Lanhu itself always
    // sends both.
    expect(buildDesignUrl(ref)).toBe(
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T1&pid=P1&project_id=P1&image_id=I1'
    );
  });

  it('round-trips through the CLI parser', () => {
    const parsed = parseLanhuUrl(buildDesignUrl(ref));
    expect(parsed.teamId).toBe('T1');
    expect(parsed.projectId).toBe('P1');
    expect(parsed.docId).toBe('I1');
  });

  it('re-adds tid that the live url had lost', () => {
    // The whole point: a switched-to design still yields a CLI-usable link.
    const resolved = resolveDesignRef(SWITCHED, store({ team_id: 'T9' }));
    const parsed = parseLanhuUrl(buildDesignUrl(resolved!));
    expect(parsed.teamId).toBe('T9');
    expect(parsed.docId).toBe('I2');
  });

  it('percent-encodes ids that contain url-unsafe characters', () => {
    const url = buildDesignUrl({ ...ref, imageId: 'a b&c' });
    expect(url).toContain('image_id=a+b%26c');
  });
});

describe('resolveDesignRef — stage page support', () => {
  const emptyStorage = { getItem: () => null };

  it('takes the image id from the caller when the url has none', () => {
    const href = 'https://lanhuapp.com/web/#/item/project/stage?tid=T&pid=P';
    expect(resolveDesignRef(href, emptyStorage, 'IMG')).toEqual({
      teamId: 'T',
      projectId: 'P',
      imageId: 'IMG'
    });
  });

  it('prefers the caller image id over the one in the url', () => {
    // The right-clicked design is more specific than the address bar.
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T&pid=P&image_id=FROM_URL';
    expect(resolveDesignRef(href, emptyStorage, 'FROM_CLICK')?.imageId).toBe(
      'FROM_CLICK'
    );
  });

  it('falls back to the url when the caller passes a placeholder', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T&pid=P&image_id=I';
    expect(resolveDesignRef(href, emptyStorage, 'undefined')?.imageId).toBe(
      'I'
    );
    expect(resolveDesignRef(href, emptyStorage, null)?.imageId).toBe('I');
  });

  it('accepts the camelCase teamId the stage page rewrites urls to', () => {
    // changeProject rebuilds the query as {type, pid, teamId} — tid is dropped.
    const href = 'https://lanhuapp.com/web/#/item/project/stage?teamId=T&pid=P';
    expect(resolveDesignRef(href, emptyStorage, 'IMG')?.teamId).toBe('T');
  });

  it('still returns null when no image id is available anywhere', () => {
    const href = 'https://lanhuapp.com/web/#/item/project/stage?tid=T&pid=P';
    expect(resolveDesignRef(href, emptyStorage, null)).toBeNull();
  });
});

describe('resolveDesignRefParts', () => {
  const emptyStorage = { getItem: () => null };

  it('reports exactly which ids are missing', () => {
    const href = 'https://lanhuapp.com/web/#/item/project/stage?pid=P';
    expect(resolveDesignRefParts(href, emptyStorage, null)).toEqual({
      teamId: null,
      projectId: 'P',
      imageId: null
    });
  });

  it('agrees with resolveDesignRef when everything resolves', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T&pid=P&image_id=I';
    expect(resolveDesignRefParts(href, emptyStorage)).toEqual({
      teamId: 'T',
      projectId: 'P',
      imageId: 'I'
    });
  });
});
