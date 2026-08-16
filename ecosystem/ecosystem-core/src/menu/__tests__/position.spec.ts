import { describe, expect, it } from 'vitest';
import { correctedTop } from '../position';

describe('correctedTop', () => {
  it('leaves a menu that already fits alone', () => {
    expect(correctedTop({ top: 100, height: 200 }, 800)).toBeNull();
  });

  it('lifts a menu that overflows the bottom edge', () => {
    // 700 + 200 + 8 - 800 = 108 over.
    expect(correctedTop({ top: 700, height: 200 }, 800)).toBe(592);
  });

  it('clamps to the top margin rather than going off-screen', () => {
    expect(correctedTop({ top: 700, height: 900 }, 800)).toBe(8);
  });

  it('honours a custom margin', () => {
    expect(correctedTop({ top: 700, height: 200 }, 800, 0)).toBe(600);
  });

  it('treats an exactly-fitting menu as fitting', () => {
    expect(correctedTop({ top: 592, height: 200 }, 800)).toBeNull();
  });
});
