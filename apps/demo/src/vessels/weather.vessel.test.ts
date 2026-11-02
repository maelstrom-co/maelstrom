import { describe, expect, it } from 'vitest';

import { weatherVessel } from './weather.vessel';

describe('weatherVessel hourly variant minSize', () => {
  it('declares a width wide enough for its 12 hour-label columns', () => {
    // At the default 80px cell size, 6 cells (the previous minSize) leaves
    // ~25px per column after padding/gaps for a ~29px text-xs font-mono
    // hour label — they overflow and collide. 9 cells is the honest minimum.
    expect(weatherVessel.variants.hourly.minSize.width).toBeGreaterThanOrEqual(
      9,
    );
  });
});

describe('weatherVessel location action', () => {
  it.each(['current', 'hourly', 'weekly', 'compact'] as const)(
    'makes setLocation available in the %s variant without a transition',
    (variant) => {
      const action = weatherVessel.variants[variant].actions.find(
        ({ name }) => name === 'setLocation',
      );
      expect(action).toMatchObject({
        name: 'setLocation',
        description: expect.stringMatching(/^Try to load/),
        parameters: [{ name: 'location', type: 'string' }],
      });
      expect(action).not.toHaveProperty('transitionsTo');
    },
  );
});

describe('weatherVessel compact variant', () => {
  const fuller = ['current', 'hourly', 'weekly'] as const;

  it('offers a compact variant alongside the fuller views', () => {
    expect(Object.keys(weatherVessel.variants)).toEqual([
      'current',
      'hourly',
      'weekly',
      'compact',
    ]);
    expect(weatherVessel.defaultVariant).toBe('current');
  });

  it('lets the compact strip fit a thin region', () => {
    expect(weatherVessel.variants.compact.minSize).toEqual({
      width: 3,
      height: 1,
    });
  });

  it.each(fuller)('can switch from %s to compact', (variant) => {
    expect(weatherVessel.variants[variant].actions).toContainEqual(
      expect.objectContaining({
        name: 'showCompact',
        idempotent: true,
        transitionsTo: 'compact',
      }),
    );
  });

  it('can switch from compact back to every fuller view', () => {
    const actions = weatherVessel.variants.compact.actions;
    expect(actions.map(({ name }) => name)).toEqual([
      'setLocation',
      'showCurrent',
      'showHourly',
      'showWeekly',
    ]);
    for (const [name, target] of [
      ['showCurrent', 'current'],
      ['showHourly', 'hourly'],
      ['showWeekly', 'weekly'],
    ] as const)
      expect(actions).toContainEqual(
        expect.objectContaining({
          name,
          idempotent: true,
          transitionsTo: target,
        }),
      );
  });

  it.each([...fuller, 'compact'] as const)(
    'describes the %s variant for the Planner',
    (variant) => {
      expect(weatherVessel.variants[variant].description).toEqual(
        expect.any(String),
      );
    },
  );

  it('tells the Planner when to choose compact', () => {
    const description = weatherVessel.variants.compact.description ?? '';
    for (const word of ['small', 'minimal', 'compact', 'tucked away'])
      expect(description).toContain(word);
    expect(weatherVessel.description).toMatch(/compact/i);
  });
});
