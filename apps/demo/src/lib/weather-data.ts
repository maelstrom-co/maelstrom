import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  type LucideIcon,
  Sun,
} from 'lucide-react';
import { withFetchTimeout } from './fetch-timeout';

export interface LiveWeather {
  readonly current: {
    temperature: number;
    weatherCode: number;
    windSpeed: number;
  };
  readonly hourly: ReadonlyArray<{
    hour: string;
    temperature: number;
    weatherCode: number;
  }>;
  readonly daily: ReadonlyArray<{
    day: string;
    high: number;
    low: number;
    weatherCode: number;
  }>;
}

export interface WeatherUnits {
  readonly temperature: 'fahrenheit' | 'celsius';
  readonly windSpeed: 'mph' | 'kmh';
}

export interface WeatherLocation {
  readonly name: string;
  readonly country?: string;
  readonly countryCode?: string;
  readonly latitude: number;
  readonly longitude: number;
}

interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
  };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// hourly/daily "time" strings from Open-Meteo (timezone=auto) have no offset,
// so they're already local to the requested coordinates — parse the fields
// directly instead of going through Date, which would reinterpret them in
// the caller's own timezone.
function formatHour(isoLocal: string): string {
  const hour = Number(isoLocal.slice(11, 13));
  if (hour === 0) return '12AM';
  if (hour === 12) return '12PM';
  return hour < 12 ? `${hour}AM` : `${hour - 12}PM`;
}

function formatDay(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  if (Number.isNaN(day)) {
    throw new Error(
      `Open-Meteo response has an unparseable daily.time entry: ${isoDate}`,
    );
  }
  return WEEKDAYS[day];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

// `response.json()` is only typed as OpenMeteoResponse by assertion, so a
// well-formed-but-wrong-typed 200 (e.g. a stringified temperature, or hourly
// arrays whose lengths disagree) would otherwise flow straight into
// mapResponse's indexing and surface as silent NaN/undefined instead of a
// caught error. This checks exactly the fields mapResponse reads.
function assertValidOpenMeteoResponse(
  data: unknown,
): asserts data is OpenMeteoResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Open-Meteo response is not an object');
  }
  const { current, hourly, daily } = data as Record<string, unknown>;

  if (typeof current !== 'object' || current === null) {
    throw new Error('Open-Meteo response is missing "current"');
  }
  const c = current as Record<string, unknown>;
  if (typeof c.time !== 'string') {
    throw new Error('Open-Meteo response has a non-string current.time');
  }
  if (!isFiniteNumber(c.temperature_2m)) {
    throw new Error(
      'Open-Meteo response has a non-numeric current.temperature_2m',
    );
  }
  if (!isFiniteNumber(c.weather_code)) {
    throw new Error(
      'Open-Meteo response has a non-numeric current.weather_code',
    );
  }
  if (!isFiniteNumber(c.wind_speed_10m)) {
    throw new Error(
      'Open-Meteo response has a non-numeric current.wind_speed_10m',
    );
  }

  if (typeof hourly !== 'object' || hourly === null) {
    throw new Error('Open-Meteo response is missing "hourly"');
  }
  const h = hourly as Record<string, unknown>;
  if (!isStringArray(h.time)) {
    throw new Error('Open-Meteo response has a non-array hourly.time');
  }
  if (h.time.length === 0) {
    throw new Error('Open-Meteo response has an empty hourly.time');
  }
  if (!isFiniteNumberArray(h.temperature_2m)) {
    throw new Error(
      'Open-Meteo response has a non-numeric hourly.temperature_2m',
    );
  }
  if (!isFiniteNumberArray(h.weather_code)) {
    throw new Error(
      'Open-Meteo response has a non-numeric hourly.weather_code',
    );
  }
  if (
    h.temperature_2m.length !== h.time.length ||
    h.weather_code.length !== h.time.length
  ) {
    throw new Error('Open-Meteo response has mismatched hourly array lengths');
  }

  if (typeof daily !== 'object' || daily === null) {
    throw new Error('Open-Meteo response is missing "daily"');
  }
  const d = daily as Record<string, unknown>;
  if (!isStringArray(d.time)) {
    throw new Error('Open-Meteo response has a non-array daily.time');
  }
  if (d.time.length === 0) {
    throw new Error('Open-Meteo response has an empty daily.time');
  }
  if (!isFiniteNumberArray(d.temperature_2m_max)) {
    throw new Error(
      'Open-Meteo response has a non-numeric daily.temperature_2m_max',
    );
  }
  if (!isFiniteNumberArray(d.temperature_2m_min)) {
    throw new Error(
      'Open-Meteo response has a non-numeric daily.temperature_2m_min',
    );
  }
  if (!isFiniteNumberArray(d.weather_code)) {
    throw new Error('Open-Meteo response has a non-numeric daily.weather_code');
  }
  if (
    d.temperature_2m_max.length !== d.time.length ||
    d.temperature_2m_min.length !== d.time.length ||
    d.weather_code.length !== d.time.length
  ) {
    throw new Error('Open-Meteo response has mismatched daily array lengths');
  }
}

function mapResponse(data: OpenMeteoResponse): LiveWeather {
  const hourlyStart = Math.max(
    0,
    data.hourly.time.findIndex((time) => time >= data.current.time),
  );

  return {
    current: {
      temperature: Math.round(data.current.temperature_2m),
      weatherCode: data.current.weather_code,
      windSpeed: Math.round(data.current.wind_speed_10m),
    },
    hourly: data.hourly.time
      .slice(hourlyStart, hourlyStart + 12)
      .map((time, i) => ({
        hour: formatHour(time),
        temperature: Math.round(data.hourly.temperature_2m[hourlyStart + i]),
        weatherCode: data.hourly.weather_code[hourlyStart + i],
      })),
    daily: data.daily.time.slice(0, 7).map((date, i) => ({
      day: formatDay(date),
      high: Math.round(data.daily.temperature_2m_max[i]),
      low: Math.round(data.daily.temperature_2m_min[i]),
      weatherCode: data.daily.weather_code[i],
    })),
  };
}

export function unitsForCountry(countryCode?: string): WeatherUnits {
  return countryCode === 'US'
    ? { temperature: 'fahrenheit', windSpeed: 'mph' }
    : { temperature: 'celsius', windSpeed: 'kmh' };
}

function assertValidGeocodingResponse(data: unknown): asserts data is {
  results?: Array<{
    name: string;
    country?: string;
    country_code?: string;
    latitude: number;
    longitude: number;
  }>;
} {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Open-Meteo geocoding response is not an object');
  }
  const { results } = data as Record<string, unknown>;
  if (results === undefined) return;
  if (!Array.isArray(results)) {
    throw new Error('Open-Meteo geocoding response has invalid "results"');
  }
  for (const result of results) {
    if (typeof result !== 'object' || result === null) {
      throw new Error('Open-Meteo geocoding result is not an object');
    }
    const value = result as Record<string, unknown>;
    if (
      typeof value.name !== 'string' ||
      (value.country !== undefined && typeof value.country !== 'string') ||
      (value.country_code !== undefined &&
        typeof value.country_code !== 'string') ||
      !isFiniteNumber(value.latitude) ||
      value.latitude < -90 ||
      value.latitude > 90 ||
      !isFiniteNumber(value.longitude) ||
      value.longitude < -180 ||
      value.longitude > 180
    ) {
      throw new Error('Open-Meteo geocoding result is malformed');
    }
  }
}

export async function fetchGeocodedLocation(
  input: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WeatherLocation> {
  const query = input.trim();
  if (query.length < 2) {
    throw new Error('Location must contain at least 2 characters');
  }
  const params = new URLSearchParams({
    name: query,
    count: '1',
    language: 'en',
  });
  const response = await fetchImpl(
    `https://geocoding-api.open-meteo.com/v1/search?${params}`,
    { signal: withFetchTimeout(signal) },
  );
  if (!response.ok) {
    throw new Error(
      `Open-Meteo geocoding request failed with status ${response.status}`,
    );
  }
  const data: unknown = await response.json();
  assertValidGeocodingResponse(data);
  const result = data.results?.[0];
  if (!result) throw new Error(`No location found for "${query}"`);
  return {
    name: result.name,
    country: result.country,
    countryCode: result.country_code,
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

/**
 * Fetches live weather for the given coordinates from Open-Meteo (no API
 * key required) and maps it to the {@link LiveWeather} shape the weather
 * vessel renders. Rejects on any network failure, non-200 response,
 * malformed payload, or a stalled connection past the timeout.
 */
export async function fetchLiveWeather(
  lat: number,
  lng: number,
  units: WeatherUnits,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<LiveWeather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    '&current=temperature_2m,weather_code,wind_speed_10m' +
    '&hourly=temperature_2m,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code' +
    `&temperature_unit=${units.temperature}&wind_speed_unit=${units.windSpeed}` +
    '&forecast_days=7&timezone=auto';

  const response = await fetchImpl(url, { signal: withFetchTimeout(signal) });
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed with status ${response.status}`);
  }
  const data: unknown = await response.json();
  assertValidOpenMeteoResponse(data);
  return mapResponse(data);
}

// WMO weather codes (https://open-meteo.com/en/docs) mapped onto lucide
// icons; codes not covered by today's demo (fog/drizzle/snow/thunder) get a
// sensible icon in the same family the old emoji table used.
const CODE_ICON: Record<number, LucideIcon> = {
  0: Sun,
  1: Cloud,
  2: Cloud,
  3: Cloud,
  45: CloudFog,
  48: CloudFog,
  51: CloudDrizzle,
  53: CloudDrizzle,
  55: CloudDrizzle,
  56: CloudDrizzle,
  57: CloudDrizzle,
  61: CloudRain,
  63: CloudRain,
  65: CloudRain,
  66: CloudRain,
  67: CloudRain,
  80: CloudRain,
  81: CloudRain,
  82: CloudRain,
  71: CloudSnow,
  73: CloudSnow,
  75: CloudSnow,
  77: CloudSnow,
  85: CloudSnow,
  86: CloudSnow,
  95: CloudLightning,
  96: CloudLightning,
  99: CloudLightning,
};

/** Maps a WMO weather code (Open-Meteo's `weather_code`) to a lucide icon component. */
export function weatherCodeToIcon(code: number): LucideIcon {
  return CODE_ICON[code] ?? Cloud;
}

// Mirrors CODE_ICON's grouping so the accessible label always names the same
// condition the icon depicts.
const CODE_LABEL: Record<number, string> = {
  0: 'Clear',
  1: 'Cloudy',
  2: 'Cloudy',
  3: 'Cloudy',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  56: 'Drizzle',
  57: 'Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Rain',
  66: 'Rain',
  67: 'Rain',
  80: 'Rain',
  81: 'Rain',
  82: 'Rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Snow',
  77: 'Snow',
  85: 'Snow',
  86: 'Snow',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

/** Maps a WMO weather code to a human-readable condition label, for the accessible text alongside an icon-only rendering. */
export function weatherCodeToLabel(code: number): string {
  return CODE_LABEL[code] ?? 'Cloudy';
}

export type SkyClass = 'clear' | 'cloud' | 'fog' | 'rain';

// Coarser than CODE_ICON — the sky-wash background only renders 4 distinct
// washes, so every precipitation code (drizzle/rain/snow/thunder) shares the
// 'rain' wash rather than each getting its own.
const CODE_SKY_CLASS: Record<number, SkyClass> = {
  0: 'clear',
  1: 'cloud',
  2: 'cloud',
  3: 'cloud',
  45: 'fog',
  48: 'fog',
};

// The real WMO precipitation codes (drizzle/rain/snow/thunder) — membership,
// not a `>= 51` range check, so an unhandled future code falls to 'cloud'
// instead of silently reading as rain the way weatherCodeToIcon already
// falls back to Cloud.
const PRECIPITATION_CODES = new Set([
  51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86,
  95, 96, 99,
]);

export function weatherCodeToSkyClass(code: number): SkyClass {
  if (CODE_SKY_CLASS[code]) return CODE_SKY_CLASS[code];
  return PRECIPITATION_CODES.has(code) ? 'rain' : 'cloud';
}

/**
 * Today's hardcoded weather values, restructured into the {@link LiveWeather}
 * shape, so the demo looks the same offline as it does with a live fetch.
 */
export const FALLBACK_WEATHER: LiveWeather = {
  current: { temperature: 72, weatherCode: 0, windSpeed: 8 },
  hourly: [
    { hour: '9AM', temperature: 68, weatherCode: 1 },
    { hour: '10AM', temperature: 70, weatherCode: 1 },
    { hour: '11AM', temperature: 71, weatherCode: 1 },
    { hour: '12PM', temperature: 72, weatherCode: 0 },
    { hour: '1PM', temperature: 74, weatherCode: 0 },
    { hour: '2PM', temperature: 75, weatherCode: 0 },
    { hour: '3PM', temperature: 75, weatherCode: 0 },
    { hour: '4PM', temperature: 74, weatherCode: 1 },
    { hour: '5PM', temperature: 73, weatherCode: 1 },
    { hour: '6PM', temperature: 70, weatherCode: 1 },
    { hour: '7PM', temperature: 68, weatherCode: 1 },
    { hour: '8PM', temperature: 65, weatherCode: 1 },
  ],
  daily: [
    { day: 'Mon', high: 75, low: 58, weatherCode: 0 },
    { day: 'Tue', high: 72, low: 55, weatherCode: 1 },
    { day: 'Wed', high: 68, low: 52, weatherCode: 61 },
    { day: 'Thu', high: 70, low: 54, weatherCode: 3 },
    { day: 'Fri', high: 73, low: 56, weatherCode: 0 },
    { day: 'Sat', high: 76, low: 59, weatherCode: 0 },
    { day: 'Sun', high: 74, low: 57, weatherCode: 1 },
  ],
};
