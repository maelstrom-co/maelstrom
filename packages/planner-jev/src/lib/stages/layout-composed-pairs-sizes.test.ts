import { describe, expect, test } from 'bun:test';

import {
  FRACTION_LEVELS,
  interpolateLevels,
  MIN_UNSTATED_FRACTION,
  partFractionShares,
} from './layout-composed-pairs-sizes.js';

describe('interpolateLevels', () => {
  const even = [0, 0.25, 0.5, 0.75, 1];

  test('reads a whole score as its level value', () => {
    expect(interpolateLevels(2, even)).toBe(0.5);
    expect(interpolateLevels(4, even)).toBe(1);
  });

  test('interpolates linearly between the two neighbouring levels', () => {
    expect(interpolateLevels(2.5, FRACTION_LEVELS)).toBeCloseTo(
      (0.5 + 2 / 3) / 2,
    );
    expect(interpolateLevels(1.25, even)).toBeCloseTo(0.3125);
  });

  test('clamps a score outside the levels to the end values', () => {
    expect(interpolateLevels(-1, even)).toBe(0);
    expect(interpolateLevels(9, even)).toBe(1);
  });
});

describe('partFractionShares', () => {
  test('gives the unstated members the remainder evenly', () => {
    const shares = partFractionShares([undefined, undefined, 0.5]);
    expect(shares[0]).toBeCloseTo(0.25);
    expect(shares[1]).toBeCloseTo(0.25);
    expect(shares[2]).toBeCloseTo(0.5);
  });

  test('splits evenly when no member states a fraction', () => {
    expect(partFractionShares([undefined, undefined])).toEqual([0.5, 0.5]);
  });

  test('reads fractions as weights when every member states one', () => {
    const shares = partFractionShares([0.5, 0.75]);
    expect(shares[0]).toBeCloseTo(0.4);
    expect(shares[1]).toBeCloseTo(0.6);
  });

  test('scales stated fractions down so each unstated member keeps its floor', () => {
    const shares = partFractionShares([0.75, 0.75, undefined]);
    expect(shares[2]).toBeCloseTo(MIN_UNSTATED_FRACTION);
    expect(shares[0]).toBeCloseTo((1 - MIN_UNSTATED_FRACTION) / 2);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  });
});

describe('partFractionShares with whole-Chart shares for the unstated members', () => {
  test('splits the remainder among the unstated members by their whole-Chart shares', () => {
    const shares = partFractionShares(
      [undefined, undefined, 0.5],
      [0.1, 0.3, 0.6],
    );
    expect(shares[0]).toBeCloseTo(0.125);
    expect(shares[1]).toBeCloseTo(0.375);
    expect(shares[2]).toBeCloseTo(0.5);
  });

  test('gives the whole-Chart share ratio when no member states a fraction', () => {
    const shares = partFractionShares([undefined, undefined], [0.125, 0.375]);
    expect(shares[0]).toBeCloseTo(0.25);
    expect(shares[1]).toBeCloseTo(0.75);
  });

  test('still scales stated fractions down to leave each unstated member its floor', () => {
    const shares = partFractionShares([0.75, 0.75, undefined], [0.4, 0.4, 0.2]);
    expect(shares[2]).toBeCloseTo(MIN_UNSTATED_FRACTION);
    expect(shares[0]).toBeCloseTo((1 - MIN_UNSTATED_FRACTION) / 2);
  });

  test('splits evenly when the unstated members have no whole-Chart share', () => {
    const shares = partFractionShares([undefined, undefined, 0.5], [0, 0, 1]);
    expect(shares[0]).toBeCloseTo(0.25);
    expect(shares[1]).toBeCloseTo(0.25);
  });
});
