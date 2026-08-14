// get_design_context — the upstream lanhu-context-mcp tool contract on top of
// @lanhu-context/core (DESIGN.md §9).
//
// Wire contract kept byte-compatible with upstream:
// - tool name `get_design_context`, input schema {url} with the same
//   description texts (via getPrompts, en-US / zh-CN);
// - mode inline → content: [text(HTML), text(mapping)?, text(tokens)?,
//   text(guide), image(base64 png)?];
// - mode files → resource_link items (file:// URIs for context.md and
//   preview.png);
// - failure → { isError: true, content: [text(message + STOP instruction)] }.
//
// One deliberate behavioral difference: degraded stages (design tokens,
// preview image, Tailwind fallback) no longer abort the whole call. Their
// warnings are appended to the end of the returned text (inline: last text
// item; files: end of context.md). `compatStrict: true` restores the
// upstream "any stage failure stops everything" semantics.

import {
  type ContentItem,
  composeContext,
  type DesignSourceClient,
  type FileDeliveryResult,
  type FileInfo,
  getPrompts,
  LanhuClient,
  type LanhuWarning,
  type PromptLang,
  type PromptPack,
  resolveOutDir,
  toLanhuError,
  writeDesignFiles
} from '@lanhu-context/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export type McpMode = 'inline' | 'files';

export interface LanhuMcpOptions {
  /** Full browser Cookie of a logged-in lanhuapp.com session. */
  lanhuToken: string;
  /** Cookie for dds.lanhuapp.com; defaults to lanhuToken. */
  ddsToken?: string;
  /** Per-request timeout in ms (default 30000). */
  timeout?: number;
  /** Retries for retryable failures (default 0; the CLI passes its value). */
  retries?: number;
  /** Language of tool description / guide / error texts (default en-US). */
  lang?: PromptLang;
  /** Default output mode when the AI does not pass one (default inline). */
  mode?: McpMode;
  /** files mode output directory (default <cwd>/.lanhu.local). */
  outDir?: string;
  tailwind?: boolean;
  twVersion?: 3 | 4;
  skipSlices?: boolean;
  unitScale?: number;
  /** Local asset path prefix used in the slice mapping. */
  assetsDir?: string;
  /**
   * Restore the upstream all-or-nothing semantics: any degraded-stage
   * warning (tokens / preview / tailwind fallback) fails the whole call with
   * isError + STOP text, exactly like lanhu-context-mcp.
   */
  compatStrict?: boolean;
  /** Injectable API client (tests). Defaults to a real LanhuClient. */
  client?: DesignSourceClient;
}

type ResourceLinkContent = {
  type: 'resource_link';
  uri: string;
  name: string;
  mimeType: string;
};

type ToolContent = ContentItem | ResourceLinkContent;

type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
};

export function registerGetDesignContext(
  server: McpServer,
  options: LanhuMcpOptions
): void {
  const p = getPrompts(options.lang);

  server.registerTool(
    'get_design_context',
    {
      description: p.TOOL_DESCRIPTION,
      inputSchema: {
        url: z.string().describe(p.URL_INPUT_DESCRIPTION)
      }
    },
    async ({ url }): Promise<ToolResult> => {
      try {
        return await runGetDesignContext(url, options, p);
      } catch (error) {
        return stopError(error, p);
      }
    }
  );
}

async function runGetDesignContext(
  url: string,
  options: LanhuMcpOptions,
  p: PromptPack
): Promise<ToolResult> {
  const client =
    options.client ??
    new LanhuClient({
      lanhuToken: options.lanhuToken,
      ddsToken: options.ddsToken,
      timeout: options.timeout,
      retries: options.retries
    });

  const result = await composeContext({
    client,
    url,
    options: {
      unitScale: options.unitScale,
      skipSlices: options.skipSlices,
      assetsDir: options.assetsDir,
      tailwind: options.tailwind,
      twVersion: options.twVersion,
      lang: options.lang
    }
  });

  // compatStrict: the first degraded warning fails the call, mirroring the
  // upstream pipeline order (tailwind fallback → tokens → preview).
  if (options.compatStrict === true && result.warnings.length > 0) {
    return stopError(result.warnings[0].message, p);
  }

  const warningsBlock = formatWarningsBlock(result.warnings);

  if ((options.mode ?? 'inline') === 'files') {
    const resolved = resolveOutDir(options.outDir);
    const contextBody = warningsBlock
      ? `${result.contextBody}\n\n${warningsBlock}`
      : result.contextBody;

    let delivery: FileDeliveryResult;
    try {
      delivery = await writeDesignFiles({
        outDir: resolved.path,
        imageId: result.imageId,
        designName: result.designName,
        contextBody,
        previewBuffer: result.previewBuffer
      });
    } catch (error) {
      return stopError(error, p);
    }

    const content: ResourceLinkContent[] = [];
    pushResourceLink(content, delivery.files.context, 'context.md');
    if (delivery.files.preview) {
      pushResourceLink(content, delivery.files.preview, 'preview.png');
    }
    return { content };
  }

  // Inline: append the warnings block to the last text item (the guide) so
  // the content array shape stays exactly what upstream clients expect —
  // text items first, optional image strictly last.
  const content: ContentItem[] = result.content.map(item => ({ ...item }));
  if (warningsBlock) {
    appendToLastText(content, `\n\n${warningsBlock}`);
  }
  return { content };
}

// Degraded warnings rendered as a plain text block. Codes stay untranslated
// (they are stable identifiers); messages are already localized by the
// prompt pack inside composeContext.
function formatWarningsBlock(warnings: LanhuWarning[]): string | undefined {
  if (warnings.length === 0) return undefined;
  const lines = warnings.map(w => `- ${w.code} (${w.severity}): ${w.message}`);
  return `warnings:\n${lines.join('\n')}`;
}

function appendToLastText(content: ContentItem[], suffix: string): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const item = content[i];
    if (item.type === 'text') {
      content[i] = { type: 'text', text: `${item.text}${suffix}` };
      return;
    }
  }
}

// Upstream formatStopError: message + STOP instruction, isError: true.
function stopError(error: unknown, p: PromptPack): ToolResult {
  const message =
    typeof error === 'string' ? error : toLanhuError(error).message;
  return {
    isError: true,
    content: [{ type: 'text', text: `${message}${p.ERROR_STOP_INSTRUCTION}` }]
  };
}

function pushResourceLink(
  content: ResourceLinkContent[],
  file: FileInfo,
  name: string
): void {
  content.push({
    type: 'resource_link',
    uri: file.uri,
    name,
    mimeType: file.mimeType
  });
}
