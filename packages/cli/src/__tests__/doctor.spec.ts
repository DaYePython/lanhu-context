// `lanhu doctor` out-dir probing: with an explicit --out-dir the check
// probes that directory; without it, it falls back to the default
// <cwd>/.lanhu.local (via resolveOutDir).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { checkOutDir } from '../commands/doctor';
import { EXIT_IO } from '../exit';

describe('doctor checkOutDir', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lanhu-doctor-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('probes the explicit --out-dir when it does not exist (out-dir-creatable, cleaned up)', async () => {
    const target = join(tmp, 'nested', 'out');
    const check = await checkOutDir(target);
    expect(check.name).toBe('out-dir-creatable');
    expect(check.ok).toBe(true);
    expect(check.detail).toContain(target);
    expect(check.exitClass).toBe(EXIT_IO);
    // The probe must not leave the directory behind.
    expect(existsSync(target)).toBe(false);
  });

  test('probes the explicit --out-dir when it already exists (out-dir-writable)', async () => {
    const check = await checkOutDir(tmp);
    expect(check.name).toBe('out-dir-writable');
    expect(check.ok).toBe(true);
    expect(check.detail).toContain(tmp);
    expect(check.exitClass).toBe(EXIT_IO);
  });

  test('reports a failure when the explicit --out-dir cannot be created', async () => {
    // A regular file as the parent makes mkdir -p fail.
    const blocker = join(tmp, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const check = await checkOutDir(join(blocker, 'sub'));
    expect(check.name).toBe('out-dir-creatable');
    expect(check.ok).toBe(false);
    expect(check.exitClass).toBe(EXIT_IO);
  });

  test('falls back to the default <cwd>/.lanhu.local when --out-dir is absent', async () => {
    const expected = resolvePath(process.cwd(), '.lanhu.local');
    const check = await checkOutDir(undefined);
    expect(check.detail).toContain(expected);
    expect(check.ok).toBe(true);
  });
});
