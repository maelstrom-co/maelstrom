import { useEffect, useState } from 'react';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { VesselCard } from '../components/vessel-card';
import { HOME } from '../lib/locations';
import {
  FALLBACK_WEATHER,
  fetchLiveWeather,
  weatherCodeToEmoji,
  type LiveWeather,
} from '../lib/weather-data';
import type { weatherVessel } from './weather.vessel';

function useLiveWeather(): LiveWeather {
  const [weather, setWeather] = useState<LiveWeather>(FALLBACK_WEATHER);

  useEffect(() => {
    let cancelled = false;
    fetchLiveWeather(HOME.lat, HOME.lng)
      .then((live) => {
        if (!cancelled) setWeather(live);
      })
      .catch(() => {
        // Offline demo must still look perfect — stay on FALLBACK_WEATHER.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return weather;
}

export default function WeatherComponent({
  variantProps,
}: TypedVesselProps<typeof weatherVessel>) {
  const variant = variantProps.variant;
  const weather = useLiveWeather();

  if (variant === 'hourly') {
    const hourlyTemps = weather.hourly.map((h) => h.temperatureF);
    const hourlyMinTemp = Math.min(...hourlyTemps);
    const hourlyMaxTemp = Math.max(...hourlyTemps);
    const hourlyTempRange = Math.max(1, hourlyMaxTemp - hourlyMinTemp);

    return (
      <VesselCard accent="cyan" label="Hourly Forecast" meta="San Francisco">
        <div className="flex items-baseline gap-1 mb-4">
          <span
            className="text-5xl font-bold tracking-tight"
            style={{ textShadow: '0 0 30px rgba(0, 240, 255, 0.15)' }}
          >
            {weather.current.temperatureF}°
          </span>
          <span className="text-sm text-gray-500">F</span>
        </div>
        <div className="flex-1 flex items-end gap-3">
          {weather.hourly.map((h) => {
            // Floor keeps bars visible on a flat curve (all pct would be 0).
            const pct = Math.max(
              ((h.temperatureF - hourlyMinTemp) / hourlyTempRange) * 100,
              8,
            );
            const isMax = h.temperatureF === hourlyMaxTemp;
            return (
              <div
                key={h.hour}
                className="flex-1 flex flex-col items-center gap-1.5"
              >
                <span className="text-base">
                  {weatherCodeToEmoji(h.weatherCode)}
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  {h.temperatureF}°
                </span>
                <div
                  className="w-full rounded-sm border border-cyan-accent/10"
                  style={{
                    height: `${pct}%`,
                    background: `linear-gradient(to top, rgba(0, 240, 255, ${isMax ? '0.3' : '0.15'}), rgba(0, 240, 255, 0.04))`,
                    boxShadow: isMax
                      ? '0 0 8px rgba(0, 240, 255, 0.15)'
                      : 'none',
                  }}
                />
                <span className="text-xs text-gray-500 font-mono">
                  {h.hour}
                </span>
              </div>
            );
          })}
        </div>
      </VesselCard>
    );
  }

  if (variant === 'weekly') {
    return (
      <VesselCard accent="cyan" label="Weekly Forecast" meta="San Francisco">
        <div className="flex-1 grid grid-cols-7 gap-2">
          {weather.daily.map((d) => (
            <div
              key={d.day}
              className="flex flex-col items-center justify-center gap-1.5 rounded-lg bg-cyan-accent/5 p-2"
            >
              <span className="text-xs text-gray-500 font-mono">{d.day}</span>
              <span className="text-xl">{weatherCodeToEmoji(d.weatherCode)}</span>
              <div className="text-sm">
                <span className="text-white font-medium">{d.highF}°</span>
                <span className="text-gray-500"> / {d.lowF}°</span>
              </div>
            </div>
          ))}
        </div>
      </VesselCard>
    );
  }

  // Current (default)
  const today = weather.daily[0];
  return (
    <VesselCard accent="cyan" label="Weather" meta="San Francisco">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-5xl mb-3">
          {weatherCodeToEmoji(weather.current.weatherCode)}
        </div>
        <div className="flex items-baseline gap-1">
          <span
            className="text-6xl font-bold tracking-tight"
            style={{ textShadow: '0 0 30px rgba(0, 240, 255, 0.15)' }}
          >
            {weather.current.temperatureF}°
          </span>
          <span className="text-sm text-gray-500">F</span>
        </div>
        {today && (
          <div className="text-xs text-gray-500 mt-1">
            H: {today.highF}° L: {today.lowF}°
          </div>
        )}
        <div className="mt-4 text-sm text-gray-400">
          💨 {weather.current.windMph} mph
        </div>
      </div>
    </VesselCard>
  );
}
