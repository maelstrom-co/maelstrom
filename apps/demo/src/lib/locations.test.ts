import { describe, expect, it } from 'vitest';
import {
  DEMO_LOCATIONS,
  HOME,
  findLocationByFuzzyName,
} from './locations';

describe('DEMO_LOCATIONS', () => {
  it('defines exactly the four demo locations with real SF coordinates', () => {
    expect(DEMO_LOCATIONS).toHaveLength(4);
    const ids = DEMO_LOCATIONS.map((loc) => loc.id).sort();
    expect(ids).toEqual(['cafe', 'gym', 'home', 'office']);

    // Bounds check (rather than pinning exact values) catches a swapped
    // lat/lng, a wrong city, or NaN, without being brittle to fixture tweaks.
    for (const loc of DEMO_LOCATIONS) {
      expect(Number.isFinite(loc.lat)).toBe(true);
      expect(Number.isFinite(loc.lng)).toBe(true);
      expect(loc.lat).toBeGreaterThanOrEqual(37.7);
      expect(loc.lat).toBeLessThanOrEqual(37.85);
      expect(loc.lng).toBeGreaterThanOrEqual(-122.52);
      expect(loc.lng).toBeLessThanOrEqual(-122.35);
    }
  });

  it('exports HOME as the home location', () => {
    expect(HOME.id).toBe('home');
    expect(HOME).toBe(DEMO_LOCATIONS.find((loc) => loc.id === 'home'));
  });
});

describe('findLocationByFuzzyName', () => {
  it('matches an exact id, case-insensitively', () => {
    expect(findLocationByFuzzyName('gym')?.id).toBe('gym');
    expect(findLocationByFuzzyName('GYM')?.id).toBe('gym');
  });

  it('matches an exact name, case-insensitively', () => {
    expect(findLocationByFuzzyName('ritual coffee')?.id).toBe('cafe');
    expect(findLocationByFuzzyName('Studio Vortex HQ')?.id).toBe('office');
  });

  it('falls back to a substring match against the name', () => {
    expect(findLocationByFuzzyName('vortex')?.id).toBe('office');
    expect(findLocationByFuzzyName('coffee')?.id).toBe('cafe');
  });

  it('falls back to a substring match against the id', () => {
    expect(findLocationByFuzzyName('gy')?.id).toBe('gym');
  });

  it('returns undefined on no match', () => {
    expect(findLocationByFuzzyName('nonexistent place')).toBeUndefined();
  });

  it('returns undefined on a blank query instead of matching the first location', () => {
    expect(findLocationByFuzzyName('')).toBeUndefined();
    expect(findLocationByFuzzyName('   ')).toBeUndefined();
  });
});
