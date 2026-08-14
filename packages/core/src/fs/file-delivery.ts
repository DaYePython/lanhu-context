// Idempotent file delivery (DESIGN.md §5.2): files are compared by content
// hash (sha256) — identical content is skipped, different content is
// overwritten, and `force: true` bypasses the comparison entirely. Each
// written file reports one of three states: written / skipped / overwritten.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LanhuError } from '../errors';

export type FileWriteStatus = 'written' | 'skipped' | 'overwritten';

export interface FileInfo {
  path: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  status: FileWriteStatus;
}

export interface DeliveryFiles {
  context: FileInfo;
  preview?: FileInfo;
}

export interface FileDeliveryInput {
  outDir: string;
  imageId: string;
  designName: string;
  /**
   * Full markdown body for context.md — same content inline mode would emit,
   * already joined by the caller.
   */
  contextBody: string;
  previewBuffer?: Buffer;
  /** Skip the content-hash comparison and always rewrite. */
  force?: boolean;
}

export interface FileDeliveryResult {
  dir: string;
  files: DeliveryFiles;
}

const IMAGE_ID_PREFIX_LENGTH = 8;

function stripControlChars(s: string): string {
  // ASCII control range (0x00–0x1f) plus DEL (0x7f).
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * Build a directory name from a Lanhu design name + imageId for files mode.
 *
 * Keeps the directory name close to the original design name: only normalizes
 * whitespace into a single dash and guards against path traversal. Inline
 * mode does no sanitization (the name is rendered as text only), so the two
 * modes are independent — touch this function freely without affecting inline.
 *
 * The imageId is truncated to the first 8 chars (UUID prefix) — enough to
 * disambiguate same-named designs within a project, while keeping the
 * directory name short and readable.
 */
export function sanitizeDesignDirName(
  designName: string,
  imageId: string
): string {
  const cleaned = stripControlChars(designName)
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  const safeName = cleaned || 'design';
  const safeImageId = imageId
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, IMAGE_ID_PREFIX_LENGTH);
  return safeImageId ? `${safeName}-${safeImageId}` : safeName;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

// Write `body` to `filePath` idempotently and report the resulting state.
// Exported for reuse by the asset downloader and `preview -o <file>`.
export async function writeFileIdempotent(
  filePath: string,
  body: Buffer,
  force: boolean
): Promise<FileWriteStatus> {
  let existing: Buffer | undefined;
  try {
    existing = await readFile(filePath);
  } catch {
    existing = undefined;
  }

  if (existing !== undefined && !force && sha256(existing) === sha256(body)) {
    return 'skipped';
  }

  try {
    await writeFile(filePath, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LanhuError(
      'IO_WRITE_FAILED',
      `Failed to write ${filePath}: ${message}`,
      { cause: error }
    );
  }
  return existing !== undefined ? 'overwritten' : 'written';
}

export async function writeDesignFiles(
  input: FileDeliveryInput
): Promise<FileDeliveryResult> {
  const dirName = sanitizeDesignDirName(input.designName, input.imageId);
  const designDir = resolvePath(input.outDir, dirName);

  try {
    await mkdir(designDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LanhuError(
      'IO_WRITE_FAILED',
      `Failed to create output directory ${designDir}: ${message}`,
      { cause: error }
    );
  }

  const force = input.force ?? false;

  const contextPath = resolvePath(designDir, 'context.md');
  const contextBuffer = Buffer.from(input.contextBody, 'utf8');
  const context = await deliver(
    contextPath,
    contextBuffer,
    'text/markdown',
    force
  );

  let preview: FileInfo | undefined;
  if (input.previewBuffer) {
    const previewPath = resolvePath(designDir, 'preview.png');
    preview = await deliver(
      previewPath,
      input.previewBuffer,
      'image/png',
      force
    );
  }

  return {
    dir: designDir,
    files: { context, preview }
  };
}

async function deliver(
  filePath: string,
  body: Buffer,
  mimeType: string,
  force: boolean
): Promise<FileInfo> {
  const status = await writeFileIdempotent(filePath, body, force);
  return {
    path: filePath,
    uri: pathToFileURL(filePath).href,
    mimeType,
    sizeBytes: body.byteLength,
    status
  };
}
