// LanhuClient: fetch-based rewrite of the upstream axios clients.
//
// Key differences from upstream (lanhu-context-mcp/src/services/clients.ts):
// - No module-level mutable singletons (`export let client`): construct an
//   instance with { lanhuToken, ddsToken, timeout } instead.
// - Built on ofetch; a custom `fetch` implementation can be injected for tests.
// - Failures are thrown as LanhuError with code/severity/exitClass/hint.
//
// All browser-masquerading request headers are preserved verbatim, including
// the fixed DDS `Authorization: Basic dW5kZWZpbmVkOg==` header.

import { Buffer } from 'node:buffer';
import { type $Fetch, createFetch } from 'ofetch';
import { LanhuError } from '../errors';
import { withRetry } from '../retry';
import {
  pickLatestVersionId,
  pickPreviewUrl,
  pickProjectName
} from '../transform/lanhu-response';
import { stripOssProcess } from '../transform/oss-url';
import type {
  DesignMeta,
  DownloadImageRequest,
  LanhuApiResponse,
  LanhuDesignRequest,
  SchemaNode
} from '../types/index';

export const BASE_URL = 'https://lanhuapp.com';
export const DDS_BASE_URL = 'https://dds.lanhuapp.com';
export const DEFAULT_HTTP_TIMEOUT = 30_000;

export interface LanhuClientOptions {
  // Full browser Cookie of a logged-in lanhuapp.com session.
  lanhuToken: string;
  // Cookie for dds.lanhuapp.com; defaults to lanhuToken.
  ddsToken?: string;
  // Per-request timeout in milliseconds. Defaults to 30000.
  timeout?: number;
  // Retries for retryable failures (timeouts, network/5xx). Defaults to 0
  // (opt-in); the CLI passes its --retries value (default 2). Non-retryable
  // errors (auth, empty payloads, usage) are never retried (DESIGN.md §6.3).
  retries?: number;
  // Base backoff delay between retries in ms (exponential). Defaults to 300.
  retryBaseDelayMs?: number;
  // Injectable fetch implementation (tests). Defaults to globalThis.fetch.
  fetch?: typeof globalThis.fetch;
}

// The capability surface the pipeline depends on. LanhuClient implements it;
// tests can substitute a stub.
export interface DesignSourceClient {
  getDesignMeta(request: LanhuDesignRequest): Promise<DesignMeta>;
  getDesignSchemaJson(request: LanhuDesignRequest): Promise<SchemaNode>;
  getSketchJson(request: LanhuDesignRequest): Promise<Record<string, unknown>>;
  downloadImage(request: DownloadImageRequest): Promise<Buffer>;
}

// Lanhu reports business failures (invalid token, missing image, no access)
// as HTTP 200 with a null payload; surface its code/msg instead of letting
// the null crash downstream destructuring.
function unwrapEnvelope<T>(
  body: LanhuApiResponse<T>,
  field: 'result' | 'data',
  endpoint: string
): T {
  const value = body[field];
  if (value != null) return value;

  const detail = [body.code, body.msg]
    .filter(v => v !== undefined && v !== null && v !== '')
    .join(' ');
  throw new LanhuError(
    'EMPTY_RESULT',
    `Lanhu API ${endpoint} returned empty ${field}${
      detail ? ` (${detail})` : ''
    }. Verify the Lanhu URL is complete (tid/pid/image_id must be full ids, not truncated) and LANHU_TOKEN is valid.`
  );
}

function isTimeoutLike(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (typeof current === 'object') {
      const name = (current as { name?: string }).name;
      if (name === 'TimeoutError' || name === 'AbortError') return true;
      const message = (current as { message?: string }).message;
      if (message && /timeout|timed out|aborted/i.test(message)) return true;
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}

export class LanhuClient implements DesignSourceClient {
  private readonly main: $Fetch;
  private readonly dds: $Fetch;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: LanhuClientOptions) {
    if (!options.lanhuToken) {
      throw new LanhuError(
        'TOKEN_MISSING',
        'LANHU_TOKEN is required to create a LanhuClient'
      );
    }
    const timeout = options.timeout ?? DEFAULT_HTTP_TIMEOUT;
    const ddsToken = options.ddsToken || options.lanhuToken;
    this.retries = Math.max(0, options.retries ?? 0);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 300;

    this.main = createFetch({
      fetch: options.fetch,
      defaults: {
        baseURL: BASE_URL,
        timeout,
        retry: false,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Referer: 'https://lanhuapp.com/web/',
          Accept: 'application/json, text/plain, */*',
          Cookie: options.lanhuToken,
          'sec-ch-ua':
            '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'request-from': 'web',
          'real-path': '/item/project/detailDetach'
        }
      }
    });

    this.dds = createFetch({
      fetch: options.fetch,
      defaults: {
        baseURL: DDS_BASE_URL,
        timeout,
        retry: false,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://dds.lanhuapp.com/',
          Cookie: ddsToken,
          Authorization: 'Basic dW5kZWZpbmVkOg=='
        }
      }
    });
  }

  // Map transport-level failures onto LanhuError while letting LanhuError
  // (already classified, e.g. EMPTY_RESULT) pass through. Retryable failures
  // (timeouts, network/5xx) are retried with exponential backoff when the
  // client was constructed with `retries > 0` (DESIGN.md §6.3).
  private guard<T>(endpoint: string, run: () => Promise<T>): Promise<T> {
    return withRetry(() => this.guardOnce(endpoint, run), {
      retries: this.retries,
      baseDelayMs: this.retryBaseDelayMs
    });
  }

  private async guardOnce<T>(
    endpoint: string,
    run: () => Promise<T>
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof LanhuError) throw error;
      if (isTimeoutLike(error)) {
        throw new LanhuError(
          'UPSTREAM_TIMEOUT',
          `Lanhu API ${endpoint} timed out`,
          { cause: error }
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new LanhuError(
        'UPSTREAM_ERROR',
        `Lanhu API ${endpoint} request failed: ${message}`,
        { cause: error }
      );
    }
  }

  // Fetch raw design detail payload for a single image.
  private async getDesignResult({
    teamId,
    projectId,
    imageId
  }: LanhuDesignRequest): Promise<Record<string, unknown>> {
    return this.guard('/api/project/image', async () => {
      const body = await this.main<LanhuApiResponse<Record<string, unknown>>>(
        '/api/project/image',
        {
          query: {
            team_id: teamId,
            project_id: projectId,
            image_id: imageId,
            dds_status: 1
          }
        }
      );
      return unwrapEnvelope(body, 'result', '/api/project/image');
    });
  }

  // Resolve the latest version id for a design from the project listing.
  private async getVersionIdByImageId({
    teamId,
    projectId,
    imageId
  }: LanhuDesignRequest): Promise<string> {
    return this.guard('/api/project/multi_info', async () => {
      const body = await this.main<LanhuApiResponse<Record<string, unknown>>>(
        '/api/project/multi_info',
        {
          query: {
            team_id: teamId,
            project_id: projectId,
            img_limit: 500,
            detach: 1
          }
        }
      );
      return pickLatestVersionId(
        unwrapEnvelope(body, 'result', '/api/project/multi_info'),
        imageId
      );
    });
  }

  // Load the DDS schema document behind a version id.
  private async fetchDdsSchema(versionId: string): Promise<SchemaNode> {
    return this.guard('/api/dds/image/store_schema_revise', async () => {
      const body = await this.dds<
        LanhuApiResponse<{ data_resource_url?: string }>
      >('/api/dds/image/store_schema_revise', {
        query: { version_id: versionId }
      });

      const schemaUrl = unwrapEnvelope(
        body,
        'data',
        '/api/dds/image/store_schema_revise'
      ).data_resource_url;
      if (!schemaUrl) {
        throw new LanhuError(
          'SCHEMA_FIELD_MISSING',
          'store_schema_revise did not return data_resource_url'
        );
      }

      return await this.dds<SchemaNode>(schemaUrl);
    });
  }

  // Return the normalized DDS schema JSON for a design.
  async getDesignSchemaJson(request: LanhuDesignRequest): Promise<SchemaNode> {
    const versionId = await this.getVersionIdByImageId(request);
    return await this.fetchDdsSchema(versionId);
  }

  // Return display-ready design metadata for a single image.
  async getDesignMeta(request: LanhuDesignRequest): Promise<DesignMeta> {
    const { name, ...result } = await this.getDesignResult(request);
    return {
      id: request.imageId,
      name: String(name ?? request.imageId),
      url: pickPreviewUrl(result),
      projectName: pickProjectName(result)
    };
  }

  // Fetch the sketch-style JSON payload for token extraction.
  async getSketchJson(
    request: LanhuDesignRequest
  ): Promise<Record<string, unknown>> {
    const { versions = [] } = (await this.getDesignResult(request)) as {
      versions?: Array<{ json_url?: string }>;
    };
    if (versions.length === 0) {
      throw new LanhuError(
        'SCHEMA_FIELD_MISSING',
        'No versions found for design'
      );
    }

    const jsonUrl = versions[0]?.json_url;
    if (!jsonUrl) {
      throw new LanhuError(
        'SCHEMA_FIELD_MISSING',
        'No json_url in design version'
      );
    }

    return this.guard(jsonUrl, async () => {
      return await this.main<Record<string, unknown>>(jsonUrl, {
        responseType: 'json'
      });
    });
  }

  // Download a preview image as a Buffer.
  async downloadImage({ imgUrl }: DownloadImageRequest): Promise<Buffer> {
    const cleanUrl = stripOssProcess(imgUrl);
    return this.guard(cleanUrl, async () => {
      const data = await this.main(cleanUrl, {
        responseType: 'arrayBuffer'
      });
      return Buffer.from(data as ArrayBuffer);
    });
  }
}
