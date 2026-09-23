import { describe, expect, test } from 'bun:test';

import { InstanceId } from '@maelstrom-co/protocol';

import {
  COMPARISON_RATIOS,
  comparisonLogRatio,
  FRACTION_LEVELS,
  interpolateLevels,
  logAreaShares,
  MIN_UNSTATED_FRACTION,
  partFractionShares,
} from './layout-composed-pairs-sizes.js';

const [calendar, weather, journal] = [
  InstanceId('calendar-main'),
  InstanceId('weather-main'),
  InstanceId('journal-main'),
];

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

describe('comparisonLogRatio', () => {
  test('maps each level to the log of its area ratio', () => {
    COMPARISON_RATIOS.forEach((ratio, level) => {
      expect(comparisonLogRatio(level)).toBeCloseTo(Math.log(ratio));
    });
  });

  test('interpolates between levels in log space', () => {
    expect(Math.exp(comparisonLogRatio(3.5))).toBeCloseTo(
      Math.sqrt(COMPARISON_RATIOS[3] * COMPARISON_RATIOS[4]),
    );
  });
});

describe('logAreaShares', () => {
  test('recovers the areas of consistent ratios', () => {
    const shares = logAreaShares(
      [calendar, weather, journal],
      [
        { first: calendar, second: weather, logRatio: 0 },
        { first: calendar, second: journal, logRatio: Math.log(0.5) },
        { first: weather, second: journal, logRatio: Math.log(0.5) },
      ],
    );
    expect(shares[calendar]).toBeCloseTo(0.25);
    expect(shares[weather]).toBeCloseTo(0.25);
    expect(shares[journal]).toBeCloseTo(0.5);
  });

  test('averages inconsistent ratios in log space', () => {
    const shares = logAreaShares(
      [calendar, weather, journal],
      [
        { first: calendar, second: weather, logRatio: Math.log(2) },
        { first: calendar, second: journal, logRatio: 0 },
        { first: weather, second: journal, logRatio: 0 },
      ],
    );
    const ratio = (shares[calendar] ?? 0) / (shares[weather] ?? 1);
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(2);
    expect(
      Object.values(shares).reduce((sum, share) => sum + share, 0),
    ).toBeCloseTo(1);
  });

  test('gives equal shares when every comparison is about the same', () => {
    const shares = logAreaShares(
      [calendar, weather],
      [{ first: calendar, second: weather, logRatio: 0 }],
    );
    expect(shares).toEqual({ [calendar]: 0.5, [weather]: 0.5 });
  });
});
