import { useSyncExternalStore } from 'react';
import type { DemoLocation } from '../lib/locations';
import type { RouteResult } from '../lib/osrm';

/**
 * Data the map vessel keeps between renders. This store carries data only —
 * which layout to render is owned by the framework via `variantProps.variant`
 * (driven by each action's `transitionsTo`). An instance can be dropped and
 * re-added (tiling mode), which resets the framework's variant back to the
 * vessel's default while this module-singleton store keeps whatever it last
 * held, so the two can disagree; components must treat `destination`/`focused`
 * as data to render *if* the variant calls for it, not as the source of truth
 * for which variant is active.
 */
export interface MapState {
  destination?: DemoLocation;
  route?: RouteResult;
  focused?: DemoLocation;
}

let state: MapState = {};

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): MapState {
  return state;
}

function setState(next: MapState): void {
  state = next;
  for (const l of listeners) l();
}

export function useMapStore(): MapState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getMapSnapshot(): MapState {
  return state;
}

export const mapActions = {
  showOverview(): void {
    setState({});
  },
  showRoute(destination: DemoLocation): void {
    setState({ destination });
  },
  // Ignored once the destination has moved on (e.g. showOverview or a
  // different showRoute fired before the OSRM fetch resolved) — a stale
  // route must not resurrect a destination that's no longer current.
  setRoute(route: RouteResult): void {
    if (!state.destination) return;
    setState({ ...state, route });
  },
  focusLocation(location: DemoLocation): void {
    setState({ focused: location });
  },
};
