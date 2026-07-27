import type { TypedVesselProps } from '@maelstrom-co/react';
import { Wind } from 'lucide-react';
import { useEffect, useState } from 'react';
import { VesselCard } from '../components/vessel-card';
import { VESSEL_ACCENTS } from '../lib/design-tokens';
import { HOME } from '../lib/locations';
import {
  FALLBACK_WEATHER,
  fetchLiveWeather,
  type LiveWeather,
  weatherCodeToIcon,
  weatherCodeToLabel,
  weatherCodeToSkyClass,
} from '../lib/weather-data';
import type { weatherVessel } from './weather.vessel';

function useLiveWeather(): LiveWeather {
  const [weather, setWeather] = useState<LiveWeather>(FALLBACK_WEATHER);

  useEffect(() => {
    const controller = new AbortController();
    fetchLiveWeather(HOME.lat, HOME.lng, fetch, controller.signal)
      .then((live) => {
        setWeather(live);
      })
      .catch(() => {
        // Offline demo must still look perfect — stay on FALLBACK_WEATHER.
        // This also swallows the AbortError from unmount/timeout, which is
        // expected and not an error worth surfacing.
      });
    return () => {
      controller.abort();
    };
  }, []);

  return weather;
}

export default function WeatherComponent({
  variantProps,
}: TypedVesselProps<typeof weatherVessel>) {
  const variant = variantProps.variant;
  const weather = useLiveWeather();
  const skyClass = weatherCodeToSkyClass(weather.current.weatherCode);

  if (variant === 'hourly') {
    const hourlyTemps = weather.hourly.map((h) => h.temperatureF);
    const hourlyMinTemp = Math.min(...hourlyTemps);
    const hourlyMaxTemp = Math.max(...hourlyTemps);
    const hourlyTempRange = Math.max(1, hourlyMaxTemp - hourlyMinTemp);

    return (
      <VesselCard
        accent={VESSEL_ACCENTS.weather}
        label="Hourly Forecast"
        meta="San Francisco"
      >
        <div className={`sky-wash sky-wash--${skyClass}`} />
        <div className="relative flex items-baseline gap-1 mb-4">
          <span className="temp-numeral text-5xl font-bold tracking-tight">
            {weather.current.temperatureF}°
          </span>
          <span className="text-sm text-ink-3">F</span>
        </div>
        <div className="relative flex-1 flex items-end gap-3">
          {weather.hourly.map((h) => {
            // Floor keeps bars visible on a flat curve (all pct would be 0).
            const pct = Math.max(
              ((h.temperatureF - hourlyMinTemp) / hourlyTempRange) * 100,
              8,
            );
            const isMax = h.temperatureF === hourlyMaxTemp;
            const HourIcon = weatherCodeToIcon(h.weatherCode);
            return (
              <div
                key={h.hour}
                className="flex-1 flex flex-col items-center gap-1.5"
              >
                <HourIcon
                  aria-hidden="true"
                  size={14}
                  strokeWidth={1.75}
                  className="text-ink-2"
                />
                <span className="sr-only">
                  {weatherCodeToLabel(h.weatherCode)}
                </span>
                <span className="text-xs text-ink-2 font-mono">
                  {h.temperatureF}°
                </span>
                <div
                  className="w-full rounded-sm border border-white/10"
                  style={{
                    height: `${pct}%`,
                    background: isMax
                      ? 'linear-gradient(to top, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03))'
                      : 'linear-gradient(to top, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))',
                  }}
                />
                <span className="text-xs text-ink-3 font-mono">{h.hour}</span>
              </div>
            );
          })}
        </div>
      </VesselCard>
    );
  }

  if (variant === 'weekly') {
    return (
      <VesselCard
        accent={VESSEL_ACCENTS.weather}
        label="Weekly Forecast"
        meta="San Francisco"
      >
        <div className={`sky-wash sky-wash--${skyClass}`} />
        <div className="relative flex-1 grid grid-cols-7 gap-2">
          {weather.daily.map((d) => {
            const DayIcon = weatherCodeToIcon(d.weatherCode);
            return (
              <div
                key={d.day}
                className="flex flex-col items-center justify-center gap-1.5 rounded-lg bg-white/[0.03] p-2"
              >
                <span className="text-xs text-ink-3 font-mono">{d.day}</span>
                <DayIcon
                  aria-hidden="true"
                  size={20}
                  strokeWidth={1.75}
                  className="text-ink-2"
                />
                <span className="sr-only">
                  {weatherCodeToLabel(d.weatherCode)}
                </span>
                <div className="text-sm">
                  <span className="text-ink font-medium">{d.highF}°</span>
                  <span className="text-ink-3"> / {d.lowF}°</span>
                </div>
              </div>
            );
          })}
        </div>
      </VesselCard>
    );
  }

  // Current (default)
  const today = weather.daily[0];
  const CurrentIcon = weatherCodeToIcon(weather.current.weatherCode);
  return (
    <VesselCard
      accent={VESSEL_ACCENTS.weather}
      label="Weather"
      meta="San Francisco"
    >
      <div className={`sky-wash sky-wash--${skyClass}`} />
      <div className="relative flex-1 flex flex-col items-center justify-center">
        <CurrentIcon
          aria-hidden="true"
          size={44}
          strokeWidth={1.75}
          className="text-ink-2 mb-3"
        />
        <span className="sr-only">
          {weatherCodeToLabel(weather.current.weatherCode)}
        </span>
        <div className="flex items-baseline gap-1">
          <span className="temp-numeral text-6xl font-bold tracking-tight">
            {weather.current.temperatureF}°
          </span>
          <span className="text-sm text-ink-3">F</span>
        </div>
        {today && (
          <div className="text-xs text-ink-3 mt-1">
            H: {today.highF}° L: {today.lowF}°
          </div>
        )}
        <div className="mt-4 flex items-center gap-1.5 text-sm text-ink-2">
          <Wind size={14} strokeWidth={1.75} />
          {weather.current.windMph} mph
        </div>
      </div>
    </VesselCard>
  );
}
