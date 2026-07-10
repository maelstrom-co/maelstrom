import { useSyncExternalStore } from 'react';
import type { DemoLocation } from '../lib/locations';
import type { RouteResult } from '../lib/osrm';

export type MapState =
  | { mode: 'overview' }
  | { mode: 'route'; destination: DemoLocation; route?: RouteResult }
  | { mode: 'focus'; location: DemoLocation };

let state: MapState = { mode: 'overview' };

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
    setState({ mode: 'overview' });
  },
  showRoute(destination: DemoLocation): void {
    setState({ mode: 'route', destination });
  },
  // Ignored once the mode has moved on (e.g. showOverview fired before the
  // OSRM fetch resolved) — a stale route must not resurrect route mode.
  setRoute(route: RouteResult): void {
    if (state.mode !== 'route') return;
    setState({ ...state, route });
  },
  focusLocation(location: DemoLocation): void {
    setState({ mode: 'focus', location });
  },
};
