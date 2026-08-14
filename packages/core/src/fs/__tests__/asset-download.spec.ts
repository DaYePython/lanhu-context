// Unit tests for the concurrent idempotent asset downloader (M3):
// three write states, concurrency bounds, per-item failure handling, and
// stopOnError early termination — all with a mocked download function.
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadAssets } from '../asset-download';

let dirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanhu-assets-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

const contentOf = (url: string) => Buffer.from(`bytes-of:${url}`);

describe('downloadAssets — idempotent write states', () => {
  test('first run writes, identical re-run skips, changed content overwrites', async () => {
    const baseDir = makeTmpDir();
    const mapping = {
      './assets/icon-1.png': 'https://cdn.example.com/a.png',
      './assets/icon-2.png': 'https://cdn.example.com/b.png'
    };

    const first = await downloadAssets({
      mapping,
      baseDir,
      download: async url => contentOf(url)
    });
    expect(first.summary).toEqual({
      total: 2,
      written: 2,
      skipped: 0,
      overwritten: 0,
      failed: 0
    });
    expect(readFileSync(join(baseDir, 'assets/icon-1.png'), 'utf8')).toBe(
      'bytes-of:https://cdn.example.com/a.png'
    );

    // Same content again: everything skipped.
    const second = await downloadAssets({
      mapping,
      baseDir,
      download: async url => contentOf(url)
    });
    expect(second.summary.skipped).toBe(2);
    expect(second.summary.written).toBe(0);

    // Remote content changed: content hash differs -> overwritten.
    const third = await downloadAssets({
      mapping,
      baseDir,
      download: async url => Buffer.from(`v2:${url}`)
    });
    expect(third.summary.overwritten).toBe(2);
  });

  test('force bypasses the hash comparison and reports overwritten', async () => {
    const baseDir = makeTmpDir();
    const mapping = { './a.png': 'https://cdn.example.com/a.png' };
    await downloadAssets({
      mapping,
      baseDir,
      download: async () => contentOf('x')
    });

    const forced = await downloadAssets({
      mapping,
      baseDir,
      force: true,
      download: async () => contentOf('x')
    });
    expect(forced.items[0].status).toBe('overwritten');
  });

  test('absolute localPath is honored as-is', async () => {
    const baseDir = makeTmpDir();
    const other = makeTmpDir();
    const absPath = join(other, 'deep/icon.png');
    const result = await downloadAssets({
      mapping: { [absPath]: 'https://cdn.example.com/a.png' },
      baseDir,
      download: async url => contentOf(url)
    });
    expect(result.items[0].absolutePath).toBe(absPath);
    expect(readFileSync(absPath, 'utf8')).toContain('bytes-of:');
  });
});

describe('downloadAssets — concurrency', () => {
  test('never runs more than `concurrency` downloads at once', async () => {
    const baseDir = makeTmpDir();
    const mapping: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      mapping[`./icon-${i}.png`] = `https://cdn.example.com/${i}.png`;
    }

    let inFlight = 0;
    let peak = 0;
    const result = await downloadAssets({
      mapping,
      baseDir,
      concurrency: 3,
      download: async url => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight--;
        return contentOf(url);
      }
    });
    expect(result.summary.written).toBe(10);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

describe('downloadAssets — failures', () => {
  test('a single failed download is recorded and the rest continue', async () => {
    const baseDir = makeTmpDir();
    const result = await downloadAssets({
      mapping: {
        './ok-1.png': 'https://cdn.example.com/ok1.png',
        './bad.png': 'https://cdn.example.com/bad.png',
        './ok-2.png': 'https://cdn.example.com/ok2.png'
      },
      baseDir,
      concurrency: 1,
      download: async url => {
        if (url.includes('bad')) throw new Error('boom 500');
        return contentOf(url);
      }
    });
    expect(result.summary).toMatchObject({ total: 3, written: 2, failed: 1 });
    const failed = result.items.find(i => i.status === 'failed');
    expect(failed?.localPath).toBe('./bad.png');
    expect(failed?.error?.message).toContain('boom 500');
  });

  test('stopOnError stops scheduling new downloads after the first failure', async () => {
    const baseDir = makeTmpDir();
    const attempted: string[] = [];
    const mapping: Record<string, string> = {};
    for (let i = 0; i < 6; i++) {
      mapping[`./icon-${i}.png`] = `https://cdn.example.com/${i}.png`;
    }

    const result = await downloadAssets({
      mapping,
      baseDir,
      concurrency: 1,
      stopOnError: true,
      download: async url => {
        attempted.push(url);
        if (url.includes('/1.png')) throw new Error('fatal download');
        return contentOf(url);
      }
    });
    // items 0 and 1 attempted; 2..5 never scheduled.
    expect(attempted).toHaveLength(2);
    expect(result.summary.failed).toBe(1);
    expect(result.items).toHaveLength(2);
  });

  test('an unwritable target directory surfaces IO_WRITE_FAILED per item', async () => {
    const baseDir = makeTmpDir();
    // Create a *file* where a directory is needed.
    writeFileSync(join(baseDir, 'blocked'), 'not a dir');
    const result = await downloadAssets({
      mapping: { './blocked/icon.png': 'https://cdn.example.com/a.png' },
      baseDir,
      download: async url => contentOf(url)
    });
    expect(result.items[0].status).toBe('failed');
    expect(result.items[0].error?.code).toBe('IO_WRITE_FAILED');
  });
});
