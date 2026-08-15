import { useSyncExternalStore } from 'react';
import { HOME } from '../lib/locations';
import {
  FALLBACK_WEATHER,
  fetchGeocodedLocation,
  fetchLiveWeather,
  type LiveWeather,
  unitsForCountry,
  type WeatherLocation,
  type WeatherUnits,
} from '../lib/weather-data';

export interface WeatherState {
  readonly location: WeatherLocation;
  readonly units: WeatherUnits;
  readonly forecast: LiveWeather;
  readonly loadingLocation: string | null;
  readonly error: string | null;
}

export interface WeatherStore {
  getSnapshot(): WeatherState;
  subscribe(listener: () => void): () => void;
  refreshDefault(): Promise<void>;
  setLocation(location: string): Promise<void>;
}

export const FALLBACK_LOCATION: WeatherLocation = {
  name: 'San Francisco',
  country: 'United States',
  countryCode: 'US',
  latitude: HOME.lat,
  longitude: HOME.lng,
};

function requestError(location: string, cause: unknown): Error {
  const detail = cause instanceof Error ? ` ${cause.message}` : '';
  return new Error(`Could not load weather for "${location}".${detail}`);
}

export function createWeatherStore(
  fetchImpl: typeof fetch = fetch,
): WeatherStore {
  let state: WeatherState = {
    location: FALLBACK_LOCATION,
    units: unitsForCountry(FALLBACK_LOCATION.countryCode),
    forecast: FALLBACK_WEATHER,
    loadingLocation: null,
    error: null,
  };
  let generation = 0;
  let controller: AbortController | undefined;
  let initialRefresh: Promise<void> | undefined;
  let explicitLocationRequested = false;
  const listeners = new Set<() => void>();

  function setState(next: WeatherState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  async function load(
    requestedLocation: string,
    resolveLocation: (signal: AbortSignal) => Promise<WeatherLocation>,
  ): Promise<void> {
    const requestGeneration = ++generation;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    setState({
      ...state,
      loadingLocation: requestedLocation,
      error: null,
    });

    try {
      const location = await resolveLocation(signal);
      if (requestGeneration !== generation) {
        throw new Error('Weather request was superseded');
      }
      const units = unitsForCountry(location.countryCode);
      const forecast = await fetchLiveWeather(
        location.latitude,
        location.longitude,
        units,
        fetchImpl,
        signal,
      );
      if (requestGeneration !== generation) {
        throw new Error('Weather request was superseded');
      }
      setState({
        location,
        units,
        forecast,
        loadingLocation: null,
        error: null,
      });
    } catch (cause) {
      if (requestGeneration === generation) {
        const error = requestError(requestedLocation, cause);
        setState({ ...state, loadingLocation: null, error: error.message });
        throw error;
      }
      throw cause;
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refreshDefault() {
      if (explicitLocationRequested) return Promise.resolve();
      initialRefresh ??= load('San Francisco', async () => FALLBACK_LOCATION);
      return initialRefresh;
    },
    setLocation(location) {
      explicitLocationRequested = true;
      const requestedLocation = location.trim();
      return load(requestedLocation, (signal) =>
        fetchGeocodedLocation(location, fetchImpl, signal),
      );
    },
  };
}

export const weatherStore = createWeatherStore();

export function useWeatherStore(): WeatherState {
  return useSyncExternalStore(
    weatherStore.subscribe,
    weatherStore.getSnapshot,
    weatherStore.getSnapshot,
  );
}
