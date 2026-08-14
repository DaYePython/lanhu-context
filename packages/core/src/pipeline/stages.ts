// Independent pipeline stages. Each stage does one thing and can be called
// on its own; composeContext() (see ./compose.ts) chains them with the
// severity model from DESIGN.md §6.

import type { Buffer } from 'node:buffer';
import type { DesignSourceClient } from '../api/client';
import { LanhuError } from '../errors';
import { convertHtmlToTailwind } from '../transform/css-to-tailwind';
import {
  type DesignTokenEntry,
  extractDesignTokenEntries,
  extractDesignTokens
} from '../transform/design-tokens';
import {
  convertLanhuToHtml,
  localizeImageUrls
} from '../transform/schema-to-html';
import type {
  DesignMeta,
  LanhuDesignRequest,
  SchemaNode
} from '../types/index';

// Stage: design metadata (name / preview URL / project name).
export function fetchMeta(
  client: DesignSourceClient,
  request: LanhuDesignRequest
): Promise<DesignMeta> {
  return client.getDesignMeta(request);
}

// Stage: raw DDS schema JSON.
export function fetchSchema(
  client: DesignSourceClient,
  request: LanhuDesignRequest
): Promise<SchemaNode> {
  return client.getDesignSchemaJson(request);
}

export interface RenderHtmlOptions {
  // Multiply all px values (e.g. 0.5 for 2x designs).
  unitScale?: number;
  // Skip slice localization: keep remote image URLs, produce no mapping.
  skipSlices?: boolean;
  // Design name used for the local asset folder in the mapping.
  designName?: string;
  // Override the local asset path prefix (default ./src/assets/<design-name>).
  assetsDir?: string;
  // Convert the generated CSS to Tailwind utility classes.
  tailwind?: boolean;
  twVersion?: 3 | 4;
}

export interface RenderHtmlResult {
  html: string;
  // localPath -> remoteUrl mapping for slice downloads (empty when skipped).
  assetsMapping: Record<string, string>;
  // True when Tailwind conversion failed and the original HTML was kept.
  tailwindFallback: boolean;
  tailwindFallbackError?: unknown;
}

// Stage: schema -> HTML(+CSS or Tailwind), with optional slice localization.
export async function renderHtml(
  schema: SchemaNode,
  options: RenderHtmlOptions = {}
): Promise<RenderHtmlResult> {
  let html: string;
  try {
    html = convertLanhuToHtml(schema, options.unitScale ?? 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LanhuError(
      'TRANSFORM_FAILED',
      `Failed to convert schema to HTML: ${message}`,
      { cause: error }
    );
  }

  let assetsMapping: Record<string, string> = {};
  if (!options.skipSlices) {
    const localized = localizeImageUrls(
      html,
      options.designName ?? '',
      options.assetsDir
    );
    html = localized.html;
    assetsMapping = localized.mapping;
  }

  let tailwindFallback = false;
  let tailwindFallbackError: unknown;
  if (options.tailwind) {
    html = await convertHtmlToTailwind(html, {
      twVersion: options.twVersion,
      onFallback: error => {
        tailwindFallback = true;
        tailwindFallbackError = error;
      }
    });
  }

  return { html, assetsMapping, tailwindFallback, tailwindFallbackError };
}

// Stage: slice mapping only (localPath -> remoteUrl) for an already-rendered HTML.
export function buildAssetsMapping(
  html: string,
  designName: string,
  assetsDir?: string
): { html: string; mapping: Record<string, string> } {
  return localizeImageUrls(html, designName, assetsDir);
}

// Stage: high-risk design tokens extracted from the Sketch JSON.
export async function extractTokens(
  client: DesignSourceClient,
  request: LanhuDesignRequest
): Promise<string> {
  const sketchJson = await client.getSketchJson(request);
  return extractDesignTokens(sketchJson);
}

// Stage: the same tokens as structured entries (for --format json/css).
export async function extractTokenEntries(
  client: DesignSourceClient,
  request: LanhuDesignRequest
): Promise<DesignTokenEntry[]> {
  const sketchJson = await client.getSketchJson(request);
  return extractDesignTokenEntries(sketchJson);
}

// Stage: preview image bytes.
export function fetchPreview(
  client: DesignSourceClient,
  imgUrl: string
): Promise<Buffer> {
  return client.downloadImage({ imgUrl });
}
