import { DESIGN_DETAIL_PATH, LANHU_ORIGIN } from './constants';

export interface DesignRef {
  teamId: string;
  projectId: string;
  imageId: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
}

// Lanhu writes literal "undefined" (common/utils/tip-team.js) and ""
// (item/api/account-project.js) into these keys, so a truthiness check alone
// would happily hand back the string "undefined" as a team id.
const PLACEHOLDERS = new Set(['', 'undefined', 'null']);

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return PLACEHOLDERS.has(trimmed) ? null : trimmed;
}

/**
 * Lanhu routes through a hash fragment, so the ids live after the `#`, not in
 * `location.search`.
 */
export function parseHashParams(href: string): URLSearchParams | null {
  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) return null;

  const fragment = href.slice(hashIndex + 1);
  const queryIndex = fragment.indexOf('?');
  if (queryIndex === -1) return null;

  return new URLSearchParams(fragment.slice(queryIndex + 1));
}

/**
 * Mirrors lanhu's own getTeamId() chain: url first, then localStorage.
 *
 * This is not defensive padding — MarkLeft.changeUrlQuery rewrites the query
 * to {pid, project_id, image_id} whenever the user switches designs, so the
 * url loses `tid` on the most common path through the page.
 *
 * imageId deliberately has no storage fallback: it is always present in the
 * url, and a stale stored value would silently reference the wrong design.
 */
export function resolveDesignRef(
  href: string,
  storage: StorageLike
): DesignRef | null {
  const params = parseHashParams(href);

  const fromUrl = (...keys: string[]): string | null => {
    if (!params) return null;
    for (const key of keys) {
      const value = clean(params.get(key));
      if (value) return value;
    }
    return null;
  };

  const fromStorage = (key: string): string | null => {
    try {
      return clean(storage.getItem(key));
    } catch {
      // Storage access can throw when the page blocks it.
      return null;
    }
  };

  const teamId = fromUrl('tid', 'team_id') ?? fromStorage('team_id');
  const projectId = fromUrl('pid', 'project_id') ?? fromStorage('pid');
  const imageId = fromUrl('image_id', 'docId');

  if (!teamId || !projectId || !imageId) return null;
  return { teamId, projectId, imageId };
}

/**
 * Rebuilds the canonical three-param form — including the `tid` the live url
 * may have dropped. Lanhu's own links carry extra params (comment_id,
 * version_id, …) that the CLI ignores; dropping them keeps the copied link
 * short and stable.
 */
export function buildDesignUrl(ref: DesignRef): string {
  const params = new URLSearchParams({
    tid: ref.teamId,
    pid: ref.projectId,
    image_id: ref.imageId
  });
  return `${LANHU_ORIGIN}/web/#/${DESIGN_DETAIL_PATH}?${params.toString()}`;
}
