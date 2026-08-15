import { describe, expect, it } from 'vitest';
import { BRIDGE_PATH, DEFAULT_BRIDGE_PORT, LANHU_ORIGIN } from '../constants';

describe('constants', () => {
  it('pins the bridge port shared with the CLI receiver', () => {
    expect(DEFAULT_BRIDGE_PORT).toBe(7623);
    expect(BRIDGE_PATH).toBe('/token');
  });

  it('pins the lanhu origin without a trailing slash', () => {
    expect(LANHU_ORIGIN).toBe('https://lanhuapp.com');
  });
});
