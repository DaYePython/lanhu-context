// Small helpers shared by the command implementations.

import {
  LanhuClient,
  type LanhuDesignRequest,
  LanhuError,
  type LanhuUrlParams
} from '@lanhu-context/core';
import { requireToken } from './config/index';
import type { RunnerContext } from './runner';

export function requireUrlArg(
  value: unknown,
  { allowStdin = false }: { allowStdin?: boolean } = {}
): string {
  if (typeof value === 'string' && value !== '') {
    if (value === '-' && !allowStdin) {
      throw new LanhuError(
        'USAGE_ERROR',
        'this command does not read from stdin; pass a Lanhu design URL'
      );
    }
    return value;
  }
  throw new LanhuError(
    'USAGE_ERROR',
    allowStdin
      ? 'missing required argument <url|-> (a Lanhu design URL, or - to read stdin)'
      : 'missing required argument <url> (a Lanhu design URL)'
  );
}

export function toDesignRequest(params: LanhuUrlParams): LanhuDesignRequest {
  return {
    teamId: params.teamId,
    projectId: params.projectId,
    imageId: params.docId
  };
}

// Build an API client from the resolved config; throws TOKEN_MISSING
// (exit 3) when no credential is available.
export function createClient(ctx: RunnerContext): LanhuClient {
  return new LanhuClient({
    lanhuToken: requireToken(ctx.config),
    ddsToken: ctx.config.ddsToken,
    timeout: ctx.config.timeout,
    retries: ctx.config.retries
  });
}
