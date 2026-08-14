// Real-network smoke test for composeContext. Opt-in only:
//
//   RUN_INTEGRATION=1 pnpm vitest run integration
//
// Reads LANHU_TOKEN / LANHU_TEST_URL from process.env or the repo-root
// .env.local. Skipped entirely (and quietly) during normal `vitest run`.
// Token values are never printed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LanhuClient } from '../api/client';
import { composeContext } from '../pipeline/compose';

function loadEnvLocal(): Record<string, string> {
  const envPath = fileURLToPath(
    new URL('../../../../.env.local', import.meta.url)
  );
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const enabled = process.env.RUN_INTEGRATION === '1';
const envFile = enabled ? loadEnvLocal() : {};
const lanhuToken = process.env.LANHU_TOKEN || envFile.LANHU_TOKEN || '';
const ddsToken = process.env.DDS_TOKEN || envFile.DDS_TOKEN || undefined;
const testUrl = process.env.LANHU_TEST_URL || envFile.LANHU_TEST_URL || '';

describe.runIf(enabled)(
  'composeContext — real API smoke (RUN_INTEGRATION=1)',
  () => {
    test('generates a context for LANHU_TEST_URL', async () => {
      expect(lanhuToken, 'LANHU_TOKEN missing in env/.env.local').toBeTruthy();
      expect(testUrl, 'LANHU_TEST_URL missing in env/.env.local').toBeTruthy();

      const client = new LanhuClient({ lanhuToken, ddsToken });
      const result = await composeContext({ client, url: testUrl });

      expect(result.designName.length).toBeGreaterThan(0);
      expect(result.contextBody).toContain('<style>');
      expect(result.contextBody.length).toBeGreaterThan(500);
      // Degraded stages may warn, but must never be fatal here.
      for (const warning of result.warnings) {
        expect(warning.severity).toBe('degraded');
      }
    }, 120_000);
  }
);
