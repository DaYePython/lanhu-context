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

export interface DesignRefParts {
  teamId: string | null;
  projectId: string | null;
  imageId: string | null;
}

/**
 * Mirrors lanhu's own getTeamId()/_getPID() chains: url first, then
 * localStorage.
 *
 * This is not defensive padding — both pages rewrite their own query. On
 * detailDetach, MarkLeft.changeUrlQuery drops `tid` when the user switches
 * designs; on stage, changeProject rebuilds the query as {type, pid, teamId},
 * dropping `tid` and switching to the camelCase spelling.
 *
 * `imageIdOverride` carries the right-clicked design on the stage page, where
 * the url has no image id at all. It wins over the url because a click target
 * is more specific than the address bar.
 */
export function resolveDesignRefParts(
  href: string,
  storage: StorageLike,
  imageIdOverride?: string | null
): DesignRefParts {
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

  return {
    teamId: fromUrl('tid', 'teamId', 'team_id') ?? fromStorage('team_id'),
    projectId: fromUrl('pid', 'project_id') ?? fromStorage('pid'),
    // No storage fallback for the image id: a stale stored value would
    // silently reference the wrong design.
    imageId: clean(imageIdOverride) ?? fromUrl('image_id', 'docId')
  };
}

export function resolveDesignRef(
  href: string,
  storage: StorageLike,
  imageIdOverride?: string | null
): DesignRef | null {
  const { teamId, projectId, imageId } = resolveDesignRefParts(
    href,
    storage,
    imageIdOverride
  );
  if (!teamId || !projectId || !imageId) return null;
  return { teamId, projectId, imageId };
}

/**
 * Rebuilds the canonical form — including the `tid` the live url may have
 * dropped. `project_id` duplicates `pid` on purpose: the detail page seeds
 * `project.id` from it and starts out undefined without it, and lanhu's own
 * links always carry both. Everything else lanhu appends (comment_id,
 * version_id, fromEditor, …) is dropped: version_id only ever serves comment
 * anchoring, and nothing in a link encodes "the version I was looking at".
 */
export function buildDesignUrl(ref: DesignRef): string {
  const params = new URLSearchParams({
    tid: ref.teamId,
    pid: ref.projectId,
    project_id: ref.projectId,
    image_id: ref.imageId
  });
  return `${LANHU_ORIGIN}/web/#/${DESIGN_DETAIL_PATH}?${params.toString()}`;
}
