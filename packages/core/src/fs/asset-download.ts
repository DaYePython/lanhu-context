// Concurrent, idempotent slice-asset downloader (DESIGN.md §5.2 + M3).
//
// - Files are compared by content hash: identical content is skipped,
//   different content is overwritten, `force` bypasses the comparison.
// - A small worker pool bounds concurrency (default 4).
// - A single failed download is recorded per-item and the rest continue;
//   `stopOnError` (CLI --strict) stops scheduling new downloads after the
//   first failure.

import type { Buffer } from 'node:buffer';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { LanhuError, toLanhuError } from '../errors';
import { type FileWriteStatus, writeFileIdempotent } from './file-delivery';

export const DEFAULT_DOWNLOAD_CONCURRENCY = 4;

export type AssetItemStatus = FileWriteStatus | 'failed';

export interface AssetDownloadItem {
  /** Local path exactly as given in the mapping (usually relative). */
  localPath: string;
  /** Absolute path the file was (or would be) written to. */
  absolutePath: string;
  remoteUrl: string;
  status: AssetItemStatus;
  bytes?: number;
  error?: { code: string; message: string };
}

export interface DownloadAssetsOptions {
  /** localPath -> remoteUrl mapping (from renderHtml/buildAssetsMapping). */
  mapping: Record<string, string>;
  /** Base directory relative localPaths resolve against (usually cwd). */
  baseDir: string;
  /** Fetches one remote asset; injectable for tests. */
  download: (remoteUrl: string) => Promise<Buffer>;
  /** Concurrent downloads; default 4, always at least 1. */
  concurrency?: number;
  /** Skip the content-hash comparison and always rewrite. */
  force?: boolean;
  /** Stop scheduling new downloads after the first failure (--strict). */
  stopOnError?: boolean;
  /** Observer invoked as each item settles (progress reporting). */
  onItem?: (item: AssetDownloadItem) => void;
}

export interface DownloadAssetsSummary {
  total: number;
  written: number;
  skipped: number;
  overwritten: number;
  failed: number;
}

export interface DownloadAssetsResult {
  items: AssetDownloadItem[];
  summary: DownloadAssetsSummary;
}

function toAbsolute(baseDir: string, localPath: string): string {
  return isAbsolute(localPath) ? localPath : resolvePath(baseDir, localPath);
}

export async function downloadAssets(
  options: DownloadAssetsOptions
): Promise<DownloadAssetsResult> {
  const entries = Object.entries(options.mapping);
  const concurrency = Math.max(
    1,
    options.concurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY
  );
  const force = options.force ?? false;
  const stopOnError = options.stopOnError ?? false;

  const items: AssetDownloadItem[] = new Array(entries.length);
  let nextIndex = 0;
  let stopped = false;

  async function downloadOne(
    localPath: string,
    remoteUrl: string
  ): Promise<AssetDownloadItem> {
    const absolutePath = toAbsolute(options.baseDir, localPath);
    try {
      const body = await options.download(remoteUrl);
      try {
        await mkdir(dirname(absolutePath), { recursive: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LanhuError(
          'IO_WRITE_FAILED',
          `Failed to create directory for ${absolutePath}: ${message}`,
          { cause: error }
        );
      }
      const status = await writeFileIdempotent(absolutePath, body, force);
      return {
        localPath,
        absolutePath,
        remoteUrl,
        status,
        bytes: body.byteLength
      };
    } catch (error) {
      const err = toLanhuError(error);
      return {
        localPath,
        absolutePath,
        remoteUrl,
        status: 'failed',
        error: { code: err.code, message: err.message }
      };
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (stopped && stopOnError) return;
      const index = nextIndex++;
      if (index >= entries.length) return;
      const [localPath, remoteUrl] = entries[index];
      const item = await downloadOne(localPath, remoteUrl);
      items[index] = item;
      if (item.status === 'failed') stopped = true;
      options.onItem?.(item);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(entries.length, 1)) },
    () => worker()
  );
  await Promise.all(workers);

  const settled = items.filter((item): item is AssetDownloadItem =>
    Boolean(item)
  );
  const summary: DownloadAssetsSummary = {
    total: entries.length,
    written: settled.filter(i => i.status === 'written').length,
    skipped: settled.filter(i => i.status === 'skipped').length,
    overwritten: settled.filter(i => i.status === 'overwritten').length,
    failed: settled.filter(i => i.status === 'failed').length
  };

  return { items: settled, summary };
}
