import { beforeEach, describe, expect, it } from 'vitest';
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
  beforeEach(() => {
    mapActions.showOverview();
  });

  it('starts with no data', () => {
    expect(getMapSnapshot()).toEqual({});
  });

  it('showRoute sets the destination with no route yet', () => {
    mapActions.showOverview();
    mapActions.showRoute(OFFICE);
    expect(getMapSnapshot()).toEqual({
      destination: OFFICE,
    });
  });

  it('setRoute attaches route info while the destination is still set', () => {
    mapActions.showOverview();
    mapActions.showRoute(OFFICE);
    const route = {
      durationMin: 12,
      distanceMi: 2.3,
      geometry: { type: 'LineString' as const, coordinates: [[0, 0], [1, 1]] },
    };
    mapActions.setRoute(route);
    expect(getMapSnapshot()).toEqual({
      destination: OFFICE,
      route,
    });
  });

  it('setRoute is a no-op if the destination was cleared before the fetch resolved', () => {
    mapActions.showOverview();
    mapActions.showRoute(OFFICE);
    mapActions.showOverview();
    mapActions.setRoute({
      durationMin: 5,
      distanceMi: 1,
      geometry: { type: 'LineString', coordinates: [] },
    });
    expect(getMapSnapshot()).toEqual({});
  });

  it('focusLocation sets the focused location', () => {
    mapActions.showOverview();
    mapActions.focusLocation(GYM);
    expect(getMapSnapshot()).toEqual({ focused: GYM });
  });

  it('showOverview clears all data', () => {
    mapActions.focusLocation(GYM);
    mapActions.showOverview();
    expect(getMapSnapshot()).toEqual({});
  });
});
