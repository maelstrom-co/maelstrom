import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { Wind } from 'lucide-react';
import { useEffect } from 'react';
import { VesselCard } from '../components/vessel-card';
import { VESSEL_ACCENTS } from '../lib/design-tokens';
import { m } from '../lib/maelstrom';
import {
  weatherCodeToIcon,
  weatherCodeToLabel,
  weatherCodeToSkyClass,
} from '../lib/weather-data';
import { useWeatherStore, weatherStore } from './weather.store';
import type { weatherVessel } from './weather.vessel';

export const weatherActionRunner = {
  setLocation: async ({ location }: { location?: unknown }) => {
    if (typeof location !== 'string') {
      return err(new Error('Weather location must be a string.'));
    }
    const requestedLocation = location.trim();
    if (
      requestedLocation.length < 2 ||
      requestedLocation.length > 160 ||
      /\p{Cc}|(?!\p{Join_Control})\p{Cf}/u.test(requestedLocation)
    ) {
      return err(
        new Error(
          'Weather location must contain 2 to 160 characters without unsupported controls.',
        ),
      );
    }
    try {
      await weatherStore.setLocation(requestedLocation);
      return ok(undefined);
    } catch {
      return err(new Error('Could not load weather for that location.'));
    }
  },
};

export default function WeatherComponent({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof weatherVessel>) {
  const variant = variantProps.variant;
  const state = useWeatherStore();
  const weather = state.forecast;
  const skyClass = weatherCodeToSkyClass(weather.current.weatherCode);
  const temperatureUnit = state.units.temperature === 'fahrenheit' ? 'F' : 'C';
  const windUnit = state.units.windSpeed === 'mph' ? 'mph' : 'km/h';
  const locationLabel = state.location.country
    ? `${state.location.name}, ${state.location.country}`
    : state.location.name;

  m.useActions('weather', instanceId, weatherActionRunner);

  useEffect(() => {
    weatherStore.refreshDefault().catch(() => {
      // The store retains the fallback and exposes the failure in the vessel.
    });
  }, []);

  const notices = (
    <div className="relative text-xs text-ink-2 space-y-1">
      <div role="status" className={state.loadingLocation ? 'mb-2' : undefined}>
        {state.loadingLocation &&
          `Loading weather for ${state.loadingLocation}...`}
      </div>
      {state.error && (
        <div role="alert" className="mb-2">
          {state.error}
        </div>
      )}
    </div>
  );

  if (variant === 'hourly') {
    const hourlyTemps = weather.hourly.map((h) => h.temperature);
    const hourlyMinTemp = Math.min(...hourlyTemps);
    const hourlyMaxTemp = Math.max(...hourlyTemps);
    const hourlyTempRange = Math.max(1, hourlyMaxTemp - hourlyMinTemp);

    return (
      <VesselCard
        accent={VESSEL_ACCENTS.weather}
        label="Hourly Forecast"
        meta={locationLabel}
      >
        <div className={`sky-wash sky-wash--${skyClass}`} />
        {notices}
        <div className="relative flex items-baseline gap-1 mb-4">
          <span className="temp-numeral text-5xl font-bold tracking-tight">
            {weather.current.temperature}°
          </span>
          <span className="text-sm text-ink-3">{temperatureUnit}</span>
        </div>
        <div className="relative flex-1 flex items-end gap-3">
          {weather.hourly.map((h) => {
            // Floor keeps bars visible on a flat curve (all pct would be 0).
            const pct = Math.max(
              ((h.temperature - hourlyMinTemp) / hourlyTempRange) * 100,
              8,
            );
            const isMax = h.temperature === hourlyMaxTemp;
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
                  {h.temperature}°
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
        meta={locationLabel}
      >
        <div className={`sky-wash sky-wash--${skyClass}`} />
        {notices}
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
                  <span className="text-ink font-medium">{d.high}°</span>
                  <span className="text-ink-3">
                    {' '}
                    / {d.low}° {temperatureUnit}
                  </span>
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
      meta={locationLabel}
    >
      <div className={`sky-wash sky-wash--${skyClass}`} />
      {notices}
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
            {weather.current.temperature}°
          </span>
          <span className="text-sm text-ink-3">{temperatureUnit}</span>
        </div>
        {today && (
          <div className="text-xs text-ink-3 mt-1">
            H: {today.high}° L: {today.low}°
          </div>
        )}
        <div className="mt-4 flex items-center gap-1.5 text-sm text-ink-2">
          <Wind size={14} strokeWidth={1.75} />
          {weather.current.windSpeed} {windUnit}
        </div>
      </div>
    </VesselCard>
  );
}
