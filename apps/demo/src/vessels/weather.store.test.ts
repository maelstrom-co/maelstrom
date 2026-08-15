import { describe, expect, it, vi } from 'vitest';
import { FALLBACK_WEATHER } from '../lib/weather-data';
import { createWeatherStore } from './weather.store';

function weatherPayload(temperature: number) {
  return {
    current: {
      time: '2026-08-15T12:00',
      temperature_2m: temperature,
      weather_code: 0,
      wind_speed_10m: 12,
    },
    hourly: {
      time: ['2026-08-15T12:00'],
      temperature_2m: [temperature],
      weather_code: [0],
    },
    daily: {
      time: ['2026-08-15'],
      temperature_2m_max: [temperature + 2],
      temperature_2m_min: [temperature - 2],
      weather_code: [0],
    },
  };
}

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe('weather external store', () => {
  it('starts with the San Francisco fallback and refreshes only once', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(weatherPayload(63)));
    const store = createWeatherStore(fetchImpl as unknown as typeof fetch);

    expect(store.getSnapshot()).toMatchObject({
      location: { name: 'San Francisco', country: 'United States' },
      units: { temperature: 'fahrenheit', windSpeed: 'mph' },
      forecast: FALLBACK_WEATHER,
      loadingLocation: null,
      error: null,
    });

    await Promise.all([store.refreshDefault(), store.refreshDefault()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().forecast.current.temperature).toBe(63);
  });

  it('commits a resolved location, metric units, and forecast together', async () => {
    const snapshots: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('geocoding-api')) {
        return response({
          results: [
            {
              name: 'Paris',
              country: 'France',
              country_code: 'FR',
              latitude: 48.8534,
              longitude: 2.3488,
            },
          ],
        });
      }
      return response(weatherPayload(24));
    });
    const store = createWeatherStore(fetchImpl as unknown as typeof fetch);
    store.subscribe(() => {
      const state = store.getSnapshot();
      snapshots.push(
        `${state.location.name}:${state.units.temperature}:${state.forecast.current.temperature}:${state.loadingLocation}`,
      );
    });

    await store.setLocation('  Paris  ');

    expect(store.getSnapshot()).toMatchObject({
      location: { name: 'Paris', country: 'France' },
      units: { temperature: 'celsius', windSpeed: 'kmh' },
      forecast: { current: { temperature: 24 } },
      loadingLocation: null,
      error: null,
    });
    expect(snapshots).toEqual([
      'San Francisco:fahrenheit:72:Paris',
      'Paris:celsius:24:null',
    ]);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('temperature_unit=celsius');
  });

  it('keeps valid data and exposes an error when a location request fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const store = createWeatherStore(fetchImpl as unknown as typeof fetch);

    await expect(store.setLocation('Paris')).rejects.toThrow('offline');
    expect(store.getSnapshot()).toMatchObject({
      location: { name: 'San Francisco' },
      forecast: FALLBACK_WEATHER,
      loadingLocation: null,
    });
    expect(store.getSnapshot().error).toContain('Paris');
  });

  it('allows only the newest overlapping request to commit success or failure', async () => {
    let rejectOld: ((error: Error) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((url: string, options?: RequestInit) => {
      if (url.includes('name=London')) {
        oldSignal = options?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          rejectOld = reject;
        });
      }
      if (url.includes('name=Paris')) {
        return Promise.resolve(
          response({
            results: [
              {
                name: 'Paris',
                country: 'France',
                country_code: 'FR',
                latitude: 48.8534,
                longitude: 2.3488,
              },
            ],
          }),
        );
      }
      return Promise.resolve(response(weatherPayload(24)));
    });
    const store = createWeatherStore(fetchImpl as unknown as typeof fetch);

    const oldRequest = store.setLocation('London');
    await store.setLocation('Paris');
    expect(oldSignal?.aborted).toBe(true);
    rejectOld?.(new Error('late failure'));
    await expect(oldRequest).rejects.toThrow('late failure');

    expect(store.getSnapshot()).toMatchObject({
      location: { name: 'Paris' },
      forecast: { current: { temperature: 24 } },
      error: null,
    });
  });

  it('does not let a late default refresh supersede an explicit location request', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('geocoding-api')) {
        return response({
          results: [
            {
              name: 'Paris',
              country: 'France',
              country_code: 'FR',
              latitude: 48.8534,
              longitude: 2.3488,
            },
          ],
        });
      }
      return response(weatherPayload(24));
    });
    const store = createWeatherStore(fetchImpl as unknown as typeof fetch);

    const locationRequest = store.setLocation('Paris');
    await store.refreshDefault();
    await locationRequest;

    expect(store.getSnapshot()).toMatchObject({
      location: { name: 'Paris' },
      forecast: { current: { temperature: 24 } },
      error: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale forecast that resolves after a newer location commits', async () => {
    let resolveLondonForecast: ((value: Response) => void) | undefined;
    let markLondonForecastStarted!: () => void;
    const londonForecastStarted = new Promise<void>((resolve) => {
      markLondonForecastStarted = resolve;
    });
    const fetchImpl = vi.fn((url: string) => {
      if (url.includes('name=London')) {
        return Promise.resolve(
          response({
            results: [
              {
                name: 'London',
                country: 'United Kingdom',
                country_code: 'GB',
                latitude: 51.5085,
                longitude: -0.1257,
              },
            ],
          }),
        );
      }
      if (url.includes('latitude=51.5085')) {
        return new Promise<Response>((resolve) => {
          resolveLondonForecast = resolve;
          markLondonForecastStarted();
        });
      }
      if (url.includes('name=Paris')) {
        return Promise.resolve(
          response({
            results: [
              {
                name: 'Paris',
                country: 'France',
                country_code: 'FR',
                latitude: 48.8534,
                longitude: 2.3488,
              },
            ],
          }),
        );
      }
      return Promise.resolve(response(weatherPayload(24)));
    });
    const store = createWeatherStore(fetchImpl as unknown as typeof fetch);

    const londonRequest = store.setLocation('London');
    await londonForecastStarted;
    await store.setLocation('Paris');
    resolveLondonForecast?.(response(weatherPayload(12)));
    await expect(londonRequest).rejects.toThrow(/superseded/i);

    expect(store.getSnapshot()).toMatchObject({
      location: { name: 'Paris' },
      forecast: { current: { temperature: 24 } },
      error: null,
    });
  });

  it('keeps fallback visible and reports an initial refresh failure', async () => {
    const store = createWeatherStore(
      vi
        .fn()
        .mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    );
    await expect(store.refreshDefault()).rejects.toThrow('offline');
    expect(store.getSnapshot().forecast).toBe(FALLBACK_WEATHER);
    expect(store.getSnapshot().error).toContain('San Francisco');
  });
});
