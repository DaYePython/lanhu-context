// Batch helper tests (§5.1/§6.2): input line parsing, dominant exit code,
// and the overall batch exit decision.
import { LanhuError } from '@lanhu-context/core';
import { decideBatchExit, dominantExitCode, parseBatchLine } from '../io/batch';

describe('parseBatchLine', () => {
  test('plain URLs and query strings pass through', () => {
    expect(parseBatchLine('https://lanhuapp.com/web/#/x?tid=a')).toBe(
      'https://lanhuapp.com/web/#/x?tid=a'
    );
    expect(parseBatchLine('tid=a&pid=b&image_id=c')).toBe(
      'tid=a&pid=b&image_id=c'
    );
  });

  test('NDJSON lines extract the url field', () => {
    expect(parseBatchLine('{"url":"tid=a&pid=b&image_id=c"}')).toBe(
      'tid=a&pid=b&image_id=c'
    );
  });

  test('broken NDJSON or a missing url field is USAGE_ERROR (exit 2)', () => {
    for (const line of ['{not json', '{}', '{"url":""}', '{"url":42}']) {
      try {
        parseBatchLine(line);
        throw new Error(`expected USAGE_ERROR for ${line}`);
      } catch (error) {
        expect(error).toBeInstanceOf(LanhuError);
        expect((error as LanhuError).code).toBe('USAGE_ERROR');
        expect((error as LanhuError).exitClass).toBe(2);
      }
    }
  });
});

describe('dominantExitCode', () => {
  test('picks the most frequent code', () => {
    expect(dominantExitCode([4, 5, 4])).toBe(4);
    expect(dominantExitCode([5, 5, 4])).toBe(5);
  });

  test('ties resolve to the code seen first; empty input is 1', () => {
    expect(dominantExitCode([5, 4])).toBe(5);
    expect(dominantExitCode([4, 5])).toBe(4);
    expect(dominantExitCode([])).toBe(1);
  });
});

describe('decideBatchExit', () => {
  test('all ok -> 0 regardless of keep-going', () => {
    expect(
      decideBatchExit({ ok: 3, failed: 0, keepGoing: false, failureCodes: [] })
    ).toBe(0);
    expect(
      decideBatchExit({ ok: 3, failed: 0, keepGoing: true, failureCodes: [] })
    ).toBe(0);
  });

  test('without --keep-going the first failure code wins (stop early)', () => {
    expect(
      decideBatchExit({ ok: 1, failed: 1, keepGoing: false, failureCodes: [4] })
    ).toBe(4);
  });

  test('--keep-going partial failure is 9 (BATCH_PARTIAL)', () => {
    expect(
      decideBatchExit({
        ok: 2,
        failed: 1,
        keepGoing: true,
        failureCodes: [5]
      })
    ).toBe(9);
  });

  test('--keep-going total failure takes the dominant error class', () => {
    expect(
      decideBatchExit({
        ok: 0,
        failed: 3,
        keepGoing: true,
        failureCodes: [4, 5, 4]
      })
    ).toBe(4);
  });
});
