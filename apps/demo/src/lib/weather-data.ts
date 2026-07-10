export interface LiveWeather {
  readonly current: {
    temperatureF: number;
    weatherCode: number;
    windMph: number;
  };
  readonly hourly: ReadonlyArray<{
    hour: string;
    temperatureF: number;
    weatherCode: number;
  }>;
  readonly daily: ReadonlyArray<{
    day: string;
    highF: number;
    lowF: number;
    weatherCode: number;
  }>;
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
  return WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
}

function mapResponse(data: OpenMeteoResponse): LiveWeather {
  const hourlyStart = Math.max(
    0,
    data.hourly.time.findIndex((time) => time >= data.current.time),
  );

  return {
    current: {
      temperatureF: Math.round(data.current.temperature_2m),
      weatherCode: data.current.weather_code,
      windMph: Math.round(data.current.wind_speed_10m),
    },
    hourly: data.hourly.time
      .slice(hourlyStart, hourlyStart + 12)
      .map((time, i) => ({
        hour: formatHour(time),
        temperatureF: Math.round(
          data.hourly.temperature_2m[hourlyStart + i],
        ),
        weatherCode: data.hourly.weather_code[hourlyStart + i],
      })),
    daily: data.daily.time.slice(0, 7).map((date, i) => ({
      day: formatDay(date),
      highF: Math.round(data.daily.temperature_2m_max[i]),
      lowF: Math.round(data.daily.temperature_2m_min[i]),
      weatherCode: data.daily.weather_code[i],
    })),
  };
}

/**
 * Fetches live weather for the given coordinates from Open-Meteo (no API
 * key required) and maps it to the {@link LiveWeather} shape the weather
 * vessel renders. Rejects on any network failure, non-200 response, or
 * malformed payload — callers should catch and keep using
 * {@link FALLBACK_WEATHER} rather than surfacing an error state.
 */
export async function fetchLiveWeather(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveWeather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    '&current=temperature_2m,weather_code,wind_speed_10m' +
    '&hourly=temperature_2m,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=7&timezone=auto';

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed with status ${response.status}`);
  }
  const data = (await response.json()) as OpenMeteoResponse;
  return mapResponse(data);
}

const DEFAULT_EMOJI = '🌡️';

// WMO weather codes (https://open-meteo.com/en/docs) mapped onto the
// component's existing emoji vocabulary; codes not covered by today's demo
// (fog/drizzle/snow/thunder) get a sensible addition in the same style.
const CODE_EMOJI: Record<number, string> = {
  0: '☀️',
  1: '🌤️',
  2: '🌤️',
  3: '🌤️',
  45: '🌫️',
  48: '🌫️',
  51: '🌦️',
  53: '🌦️',
  55: '🌦️',
  56: '🌦️',
  57: '🌦️',
  61: '🌧️',
  63: '🌧️',
  65: '🌧️',
  66: '🌧️',
  67: '🌧️',
  80: '🌧️',
  81: '🌧️',
  82: '🌧️',
  71: '🌨️',
  73: '🌨️',
  75: '🌨️',
  77: '🌨️',
  85: '🌨️',
  86: '🌨️',
  95: '⛈️',
  96: '⛈️',
  99: '⛈️',
};

/** Maps a WMO weather code (Open-Meteo's `weather_code`) to a display emoji. */
export function weatherCodeToEmoji(code: number): string {
  return CODE_EMOJI[code] ?? DEFAULT_EMOJI;
}

/**
 * Today's hardcoded weather values, restructured into the {@link LiveWeather}
 * shape, so the demo looks the same offline as it does with a live fetch.
 */
export const FALLBACK_WEATHER: LiveWeather = {
  current: { temperatureF: 72, weatherCode: 0, windMph: 8 },
  hourly: [
    { hour: '9AM', temperatureF: 68, weatherCode: 1 },
    { hour: '10AM', temperatureF: 70, weatherCode: 1 },
    { hour: '11AM', temperatureF: 71, weatherCode: 1 },
    { hour: '12PM', temperatureF: 72, weatherCode: 0 },
    { hour: '1PM', temperatureF: 74, weatherCode: 0 },
    { hour: '2PM', temperatureF: 75, weatherCode: 0 },
    { hour: '3PM', temperatureF: 75, weatherCode: 0 },
    { hour: '4PM', temperatureF: 74, weatherCode: 1 },
    { hour: '5PM', temperatureF: 73, weatherCode: 1 },
    { hour: '6PM', temperatureF: 70, weatherCode: 1 },
    { hour: '7PM', temperatureF: 68, weatherCode: 1 },
    { hour: '8PM', temperatureF: 65, weatherCode: 1 },
  ],
  daily: [
    { day: 'Mon', highF: 75, lowF: 58, weatherCode: 0 },
    { day: 'Tue', highF: 72, lowF: 55, weatherCode: 1 },
    { day: 'Wed', highF: 68, lowF: 52, weatherCode: 61 },
    { day: 'Thu', highF: 70, lowF: 54, weatherCode: 3 },
    { day: 'Fri', highF: 73, lowF: 56, weatherCode: 0 },
    { day: 'Sat', highF: 76, lowF: 59, weatherCode: 0 },
    { day: 'Sun', highF: 74, lowF: 57, weatherCode: 1 },
  ],
};
