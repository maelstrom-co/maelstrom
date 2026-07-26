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
