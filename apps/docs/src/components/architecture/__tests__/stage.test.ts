import { describe, expect, it } from 'bun:test';
import { anchor, POS } from '../stage';

describe('anchor', () => {
  it('returns the box-edge point on the ray toward the target', () => {
    // From client's center toward protocol (straight right): the ray exits at
    // the right edge — half a box-width away, on the same y.
    const p = anchor(POS.client, POS.protocol.x, POS.protocol.y);
    expect(p.x).toBe(POS.client.x + POS.client.w / 2);
    expect(p.y).toBe(POS.client.y);
  });

  it('falls back to the node center for a coincident target (no NaN)', () => {
    const p = anchor(POS.client, POS.client.x, POS.client.y);
    expect(Number.isNaN(p.x)).toBe(false);
    expect(Number.isNaN(p.y)).toBe(false);
    expect(p.x).toBe(POS.client.x);
    expect(p.y).toBe(POS.client.y);
  });
});
