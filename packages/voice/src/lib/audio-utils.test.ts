import { describe, it, expect } from 'bun:test';
import { floatToPcm16 } from './audio-utils';

describe('floatToPcm16', () => {
  it('returns empty Uint8Array for empty input', () => {
    const result = floatToPcm16(new Float32Array([]));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it('converts zero to zero bytes', () => {
    const result = floatToPcm16(new Float32Array([0]));
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
  });

  it('maps max positive (1.0) to 0x7FFF little-endian', () => {
    const result = floatToPcm16(new Float32Array([1.0]));
    expect(result[0]).toBe(0xff); // low byte
    expect(result[1]).toBe(0x7f); // high byte
  });

  it('maps max negative (-1.0) to 0x8000 little-endian', () => {
    const result = floatToPcm16(new Float32Array([-1.0]));
    expect(result[0]).toBe(0x00); // low byte
    expect(result[1]).toBe(0x80); // high byte
  });

  it('clamps values above 1.0 to 0x7FFF', () => {
    const result = floatToPcm16(new Float32Array([2.0]));
    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0x7f);
  });

  it('clamps values below -1.0 to 0x8000', () => {
    const result = floatToPcm16(new Float32Array([-2.0]));
    expect(result[0]).toBe(0x00);
    expect(result[1]).toBe(0x80);
  });

  it('output length is always 2x input length', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1.0, -1.0]);
    const result = floatToPcm16(input);
    expect(result.length).toBe(input.length * 2);
  });

  it('correctly converts a multi-sample array [0.5, -0.5]', () => {
    const result = floatToPcm16(new Float32Array([0.5, -0.5]));

    // 0.5 * 0x7FFF = 16383.5 → truncated to 16383 = 0x3FFF, little-endian: 0xFF, 0x3F
    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0x3f);

    // -0.5 * 0x8000 = -16384 = 0xC000, little-endian: 0x00, 0xC0
    expect(result[2]).toBe(0x00);
    expect(result[3]).toBe(0xc0);
  });
});
