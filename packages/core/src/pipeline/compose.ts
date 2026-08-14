// composeContext(): the composite pipeline, equivalent to upstream
// generateDesignContext with one key behavioral difference (DESIGN.md §6):
// failures of the *optional* stages (design tokens, preview image, Tailwind
// conversion) no longer abort the whole run — they are collected into a
// `warnings` array (severity "degraded") and the core HTML artifact is still
// returned. Fatal stages (URL parsing, metadata, schema, schema->HTML) still
// throw LanhuError.

import type { Buffer } from 'node:buffer';
import type { DesignSourceClient } from '../api/client';
import { type LanhuWarning, makeWarning } from '../errors';
import type { LanhuDesignRequest, LanhuUrlParams } from '../types/index';
import { parseLanhuUrl } from '../url/parse';
import { getPrompts, type PromptLang } from './prompts/index';
import {
  extractTokens,
  fetchMeta,
  fetchPreview,
  fetchSchema,
  renderHtml
} from './stages';

export type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ComposeContextOptions {
  unitScale?: number;
  skipSlices?: boolean;
  // Override the local asset path prefix used in the slice mapping.
  assetsDir?: string;
  tailwind?: boolean;
  twVersion?: 3 | 4;
  lang?: PromptLang;
}

export interface ComposeContextInput {
  client: DesignSourceClient;
  // Either a full/partial Lanhu URL...
  url?: string;
  // ...or already-parsed params.
  params?: LanhuUrlParams;
  options?: ComposeContextOptions;
}

export interface ComposeContextResult {
  designName: string;
  projectName?: string;
  imageId: string;
  // Markdown body (all text content items joined) — what files mode writes.
  contextBody: string;
  // Structured content items (text blocks + optional preview image).
  content: ContentItem[];
  previewBuffer?: Buffer;
  // localPath -> remoteUrl slice download mapping (empty when skipped/none).
  assetsMapping: Record<string, string>;
  // Degraded/notice issues encountered while producing the core artifact.
  warnings: LanhuWarning[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function composeContext({
  client,
  url,
  params,
  options = {}
}: ComposeContextInput): Promise<ComposeContextResult> {
  const p = getPrompts(options.lang);
  const parsed = params ?? parseLanhuUrl(url ?? '');
  const imageId = parsed.docId;
  const designRequest: LanhuDesignRequest = {
    teamId: parsed.teamId,
    projectId: parsed.projectId,
    imageId
  };
  const warnings: LanhuWarning[] = [];

  // Fatal stages: metadata + schema + HTML rendering.
  const design = await fetchMeta(client, designRequest);
  const schema = await fetchSchema(client, designRequest);
  const rendered = await renderHtml(schema, {
    unitScale: options.unitScale,
    skipSlices: options.skipSlices,
    designName: design.name,
    assetsDir: options.assetsDir,
    tailwind: options.tailwind,
    twVersion: options.twVersion
  });

  if (rendered.tailwindFallback) {
    warnings.push(
      makeWarning(
        'TAILWIND_FALLBACK',
        `Tailwind v${options.twVersion === 4 ? 4 : 3} conversion failed; kept original HTML+CSS: ${errorMessage(rendered.tailwindFallbackError)}`
      )
    );
  }

  let mappingText: string | undefined;
  const mappingEntries = Object.entries(rendered.assetsMapping);
  if (mappingEntries.length > 0) {
    const curlLines = mappingEntries
      .map(
        ([localPath, remoteUrl]) => `  curl -o "${localPath}" "${remoteUrl}"`
      )
      .join('\n');
    mappingText = p.imageMappingText(mappingEntries.length, curlLines);
  }

  // Degraded stage: design tokens.
  let designTokens: string | undefined;
  try {
    const tokens = await extractTokens(client, designRequest);
    if (tokens) {
      designTokens = `${p.DESIGN_TOKENS_HEADER}\n${tokens
        .split('\n')
        .map(line => `  ${line}`)
        .join('\n')}`;
    }
  } catch (error) {
    warnings.push(
      makeWarning(
        'TOKENS_UNAVAILABLE',
        p.ERROR_DESIGN_TOKENS(errorMessage(error))
      )
    );
  }

  // Degraded stage: preview image.
  let previewBuffer: Buffer | undefined;
  if (design.url) {
    try {
      previewBuffer = await fetchPreview(client, design.url);
    } catch (error) {
      warnings.push(
        makeWarning(
          'PREVIEW_UNAVAILABLE',
          p.ERROR_IMAGE_DOWNLOAD(errorMessage(error))
        )
      );
    }
  }

  const htmlLabel = options.tailwind
    ? p.HTML_CODE_LABEL_TAILWIND
    : p.HTML_CODE_LABEL;
  const guideText = p.guideText(design.projectName, design.name);
  const content: ContentItem[] = [
    { type: 'text', text: `${htmlLabel}${rendered.html}` }
  ];
  if (mappingText) content.push({ type: 'text', text: mappingText });
  if (designTokens) content.push({ type: 'text', text: designTokens });
  content.push({ type: 'text', text: guideText });
  if (previewBuffer) {
    content.push({
      type: 'image',
      data: previewBuffer.toString('base64'),
      mimeType: 'image/png'
    });
  }

  const contextBody = content
    .filter(
      (item): item is { type: 'text'; text: string } => item.type === 'text'
    )
    .map(item => item.text)
    .join('\n\n');

  return {
    designName: design.name,
    projectName: design.projectName,
    imageId,
    contextBody,
    content,
    previewBuffer,
    assetsMapping: rendered.assetsMapping,
    warnings
  };
}
