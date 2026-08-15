import { DESIGN_DETAIL_PATH, LANHU_ORIGIN } from './constants';

export interface DesignRef {
  teamId: string;
  projectId: string;
  imageId: string;
}

/**
 * Lanhu routes through a hash fragment, so the design ids live after the `#`,
 * not in `location.search`. Alias rules mirror core's parseLanhuUrl:
 * pid|project_id and image_id|docId.
 */
export function parseDesignRefFromHash(href: string): DesignRef | null {
  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) return null;

  const fragment = href.slice(hashIndex + 1);
  const queryIndex = fragment.indexOf('?');
  if (queryIndex === -1) return null;

  const params = new URLSearchParams(fragment.slice(queryIndex + 1));
  const teamId = params.get('tid');
  const projectId = params.get('pid') ?? params.get('project_id');
  const imageId = params.get('image_id') ?? params.get('docId');

  if (!teamId || !projectId || !imageId) return null;
  return { teamId, projectId, imageId };
}

/**
 * Rebuilds the canonical three-param form. Lanhu's own links carry extra
 * params (comment_id, version_id, …) that the CLI ignores; dropping them
 * keeps the copied link short and stable.
 */
export function buildDesignUrl(ref: DesignRef): string {
  const params = new URLSearchParams({
    tid: ref.teamId,
    pid: ref.projectId,
    image_id: ref.imageId
  });
  return `${LANHU_ORIGIN}/web/#/${DESIGN_DETAIL_PATH}?${params.toString()}`;
}
