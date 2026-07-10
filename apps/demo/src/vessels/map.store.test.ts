import { describe, expect, it } from 'vitest';
import { findLocationByFuzzyName } from '../lib/locations';
import { getMapSnapshot, mapActions } from './map.store';

function mustFind(id: string) {
  const loc = findLocationByFuzzyName(id);
  if (!loc) throw new Error(`fixture location "${id}" not found`);
  return loc;
}

const OFFICE = mustFind('office');
const GYM = mustFind('gym');

describe('mapActions', () => {
  it('starts in overview mode', () => {
    expect(getMapSnapshot()).toEqual({ mode: 'overview' });
  });

  it('showRoute transitions to route mode with the destination and no route yet', () => {
    mapActions.showOverview();
    mapActions.showRoute(OFFICE);
    expect(getMapSnapshot()).toEqual({
      mode: 'route',
      destination: OFFICE,
    });
  });

  it('setRoute attaches route info when still in route mode for that destination', () => {
    mapActions.showOverview();
    mapActions.showRoute(OFFICE);
    const route = {
      durationMin: 12,
      distanceMi: 2.3,
      geometry: { type: 'LineString' as const, coordinates: [[0, 0], [1, 1]] },
    };
    mapActions.setRoute(route);
    expect(getMapSnapshot()).toEqual({
      mode: 'route',
      destination: OFFICE,
      route,
    });
  });

  it('setRoute is a no-op if the mode moved away from route before the fetch resolved', () => {
    mapActions.showOverview();
    mapActions.showRoute(OFFICE);
    mapActions.showOverview();
    mapActions.setRoute({
      durationMin: 5,
      distanceMi: 1,
      geometry: { type: 'LineString', coordinates: [] },
    });
    expect(getMapSnapshot()).toEqual({ mode: 'overview' });
  });

  it('focusLocation transitions to focus mode with the location', () => {
    mapActions.showOverview();
    mapActions.focusLocation(GYM);
    expect(getMapSnapshot()).toEqual({ mode: 'focus', location: GYM });
  });

  it('showOverview resets to overview mode from any other mode', () => {
    mapActions.focusLocation(GYM);
    mapActions.showOverview();
    expect(getMapSnapshot()).toEqual({ mode: 'overview' });
  });
});
