import { describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_WEATHER,
  fetchLiveWeather,
  weatherCodeToEmoji,
} from './weather-data';

// Real Open-Meteo response shape (field names/nesting) captured via:
// curl 'https://api.open-meteo.com/v1/forecast?latitude=37.7648&longitude=-122.433
//   &current=temperature_2m,weather_code,wind_speed_10m
//   &hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code
//   &temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=7&timezone=auto'
const OPEN_METEO_FIXTURE = {
  latitude: 37.75607,
  longitude: -122.44574,
  timezone: 'America/Los_Angeles',
  current: {
    time: '2026-07-09T21:15',
    temperature_2m: 54.7,
    weather_code: 2,
    wind_speed_10m: 15.7,
  },
  hourly: {
    time: [
      '2026-07-09T18:00',
      '2026-07-09T19:00',
      '2026-07-09T20:00',
      '2026-07-09T21:00',
      '2026-07-09T22:00',
      '2026-07-09T23:00',
      '2026-07-10T00:00',
      '2026-07-10T01:00',
      '2026-07-10T02:00',
      '2026-07-10T03:00',
      '2026-07-10T04:00',
      '2026-07-10T05:00',
      '2026-07-10T06:00',
      '2026-07-10T07:00',
      '2026-07-10T08:00',
      '2026-07-10T09:00',
    ],
    temperature_2m: [
      58.2, 56.9, 55.8, 54.7, 53.9, 53.1, 52.6, 52.0, 51.5, 51.2, 51.0, 50.8,
      50.9, 51.4, 52.6, 55.3,
    ],
    weather_code: [1, 1, 2, 2, 3, 3, 45, 45, 45, 45, 45, 45, 3, 3, 1, 0],
  },
  daily: {
    time: [
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
    ],
    temperature_2m_max: [65.5, 62.9, 67.6, 75.5, 75.5, 73.7, 72.1],
    temperature_2m_min: [52.9, 53.6, 53.7, 57.9, 59.7, 58.4, 58.2],
    weather_code: [45, 45, 45, 3, 3, 0, 0],
  },
};

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('fetchLiveWeather', () => {
  it('maps current conditions, rounding temperature and wind speed', async () => {
    const result = await fetchLiveWeather(
      37.7648,
      -122.433,
      fakeFetch(OPEN_METEO_FIXTURE),
    );
    expect(result.current).toEqual({
      temperatureF: 55,
      weatherCode: 2,
      windMph: 16,
    });
  });

  it('maps the next 12 hourly entries starting after the current time', async () => {
    const result = await fetchLiveWeather(
      37.7648,
      -122.433,
      fakeFetch(OPEN_METEO_FIXTURE),
    );
    expect(result.hourly).toHaveLength(12);
    expect(result.hourly[0]).toEqual({
      hour: '10PM',
      temperatureF: 54,
      weatherCode: 3,
    });
    expect(result.hourly[11]).toEqual({
      hour: '9AM',
      temperatureF: 55,
      weatherCode: 0,
    });
  });

  it('maps 7 daily entries with weekday labels and rounded high/low', async () => {
    const result = await fetchLiveWeather(
      37.7648,
      -122.433,
      fakeFetch(OPEN_METEO_FIXTURE),
    );
    expect(result.daily).toHaveLength(7);
    expect(result.daily[0]).toEqual({
      day: 'Thu',
      highF: 66,
      lowF: 53,
      weatherCode: 45,
    });
    expect(result.daily[6]).toEqual({
      day: 'Wed',
      highF: 72,
      lowF: 58,
      weatherCode: 0,
    });
  });

  it('builds the request URL from the given coordinates', async () => {
    const fetchImpl = fakeFetch(OPEN_METEO_FIXTURE);
    await fetchLiveWeather(37.7648, -122.433, fetchImpl);
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toContain('latitude=37.7648');
    expect(url).toContain('longitude=-122.433');
  });

  it('rejects on a non-200 response', async () => {
    await expect(
      fetchLiveWeather(37.7648, -122.433, fakeFetch({}, false, 500)),
    ).rejects.toThrow();
  });

  it('rejects on a network failure', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(
      fetchLiveWeather(37.7648, -122.433, failing as unknown as typeof fetch),
    ).rejects.toThrow();
  });

  it('rejects on a malformed response missing expected fields', async () => {
    await expect(
      fetchLiveWeather(37.7648, -122.433, fakeFetch({ current: {} })),
    ).rejects.toThrow();
  });
});

describe('weatherCodeToEmoji', () => {
  it('maps clear sky (0)', () => {
    expect(weatherCodeToEmoji(0)).toBe('☀️');
  });

  it('maps partly cloudy (1-3)', () => {
    expect(weatherCodeToEmoji(1)).toBe('🌤️');
    expect(weatherCodeToEmoji(2)).toBe('🌤️');
    expect(weatherCodeToEmoji(3)).toBe('🌤️');
  });

  it('maps fog (45, 48)', () => {
    expect(weatherCodeToEmoji(45)).toBe('🌫️');
    expect(weatherCodeToEmoji(48)).toBe('🌫️');
  });

  it('maps drizzle (51-57)', () => {
    for (const code of [51, 53, 55, 56, 57]) {
      expect(weatherCodeToEmoji(code)).toBe('🌦️');
    }
  });

  it('maps rain (61-67, 80-82)', () => {
    for (const code of [61, 63, 65, 66, 67, 80, 81, 82]) {
      expect(weatherCodeToEmoji(code)).toBe('🌧️');
    }
  });

  it('maps snow (71-77, 85-86)', () => {
    for (const code of [71, 73, 75, 77, 85, 86]) {
      expect(weatherCodeToEmoji(code)).toBe('🌨️');
    }
  });

  it('maps thunderstorms (95-99)', () => {
    for (const code of [95, 96, 99]) {
      expect(weatherCodeToEmoji(code)).toBe('⛈️');
    }
  });

  it('falls back to a default emoji for unrecognized codes', () => {
    expect(weatherCodeToEmoji(-1)).toBe('🌡️');
  });
});

describe('FALLBACK_WEATHER', () => {
  it('matches today\'s hardcoded current conditions', () => {
    expect(FALLBACK_WEATHER.current).toEqual({
      temperatureF: 72,
      weatherCode: 0,
      windMph: 8,
    });
  });

  it('provides 12 hourly entries', () => {
    expect(FALLBACK_WEATHER.hourly).toHaveLength(12);
  });

  it('provides 7 daily entries starting with today\'s 75/58', () => {
    expect(FALLBACK_WEATHER.daily).toHaveLength(7);
    expect(FALLBACK_WEATHER.daily[0]).toMatchObject({
      day: 'Mon',
      highF: 75,
      lowF: 58,
    });
  });
});
