import { describe, expect, test } from 'bun:test';

import { VesselId } from './vessel-id.js';

describe('VesselId', () => {
  test('preserves the provided value when given a non-empty string', () => {
    expect(VesselId('calendar')).toBe('calendar' as VesselId);
  });

  test('throws on an empty string', () => {
    expect(() => VesselId('')).toThrow(/non-empty/i);
  });

  test('throws on whitespace-only strings', () => {
    expect(() => VesselId('   ')).toThrow(/non-empty/i);
    expect(() => VesselId('\t')).toThrow(/non-empty/i);
    expect(() => VesselId('\n')).toThrow(/non-empty/i);
  });

  test('is idempotent — branding an already-branded value is a no-op', () => {
    const id = VesselId('orders');
    expect(VesselId(id)).toBe(id);
  });
});
