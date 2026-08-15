// @vitest-environment happy-dom

import { isErr, isOk } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveWeather } from '../lib/weather-data';
import type { WeatherState } from './weather.store';
import type { weatherVessel } from './weather.vessel';

const FLAT_WEATHER: LiveWeather = {
  current: { temperature: 18, weatherCode: 45, windSpeed: 16 },
  hourly: Array.from({ length: 12 }, (_, i) => ({
    hour: `${i + 1}AM`,
    temperature: 18,
    weatherCode: 45,
  })),
  daily: Array.from({ length: 7 }, (_, i) => ({
    day: `D${i}`,
    high: 20,
    low: 12,
    weatherCode: 45,
  })),
};

let storeState: WeatherState;
const setLocation = vi.fn();
const refreshDefault = vi.fn().mockResolvedValue(undefined);
const useActions = vi.fn();

vi.mock('../lib/maelstrom', () => ({ m: { useActions } }));
vi.mock('./weather.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./weather.store')>();
  return {
    ...actual,
    weatherStore: { setLocation, refreshDefault },
    useWeatherStore: () => storeState,
  };
});

const { default: WeatherComponent, weatherActionRunner } = await import(
  './weather.component'
);

function props(
  variant: 'current' | 'hourly' | 'weekly',
): TypedVesselProps<typeof weatherVessel> {
  return {
    instanceId: `weather-test-${variant}`,
    variantProps: { variant },
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof weatherVessel>;
}

beforeEach(() => {
  storeState = {
    location: {
      name: 'Paris',
      country: 'France',
      countryCode: 'FR',
      latitude: 48.8534,
      longitude: 2.3488,
    },
    units: { temperature: 'celsius', windSpeed: 'kmh' },
    forecast: FLAT_WEATHER,
    loadingLocation: null,
    error: null,
  };
  setLocation.mockReset();
  refreshDefault.mockClear();
  useActions.mockClear();
});

afterEach(cleanup);

describe('weather variants', () => {
  it.each([
    'current',
    'hourly',
    'weekly',
  ] as const)('renders the dynamic city, country, and metric units in %s', (variant) => {
    const { container } = render(<WeatherComponent {...props(variant)} />);
    expect(container.textContent).toContain('Paris, France');
    expect(container.textContent).toContain('C');
    if (variant === 'current') expect(container.textContent).toContain('km/h');
  });

  it('renders Fahrenheit and mph for a US location', () => {
    storeState = {
      ...storeState,
      location: {
        ...storeState.location,
        name: 'New York',
        country: 'United States',
        countryCode: 'US',
      },
      units: { temperature: 'fahrenheit', windSpeed: 'mph' },
    };
    const { container } = render(<WeatherComponent {...props('current')} />);
    expect(container.textContent).toContain('New York, United States');
    expect(container.textContent).toContain('F');
    expect(container.textContent).toContain('mph');
  });

  it('keeps every hourly bar visible for a flat temperature curve', () => {
    const { container, getAllByText } = render(
      <WeatherComponent {...props('hourly')} />,
    );
    expect(getAllByText('18°')).toHaveLength(13);
    const bars = Array.from(container.querySelectorAll('div')).filter((div) =>
      div.style.height.endsWith('%'),
    );
    expect(bars).toHaveLength(12);
    for (const bar of bars) {
      expect(Number.parseFloat(bar.style.height)).toBeGreaterThan(0);
    }
  });

  it('renders condition labels for icon-only hourly, weekly, and current views', () => {
    expect(
      render(<WeatherComponent {...props('hourly')} />).getAllByText('Fog'),
    ).toHaveLength(12);
    cleanup();
    expect(
      render(<WeatherComponent {...props('weekly')} />).getAllByText('Fog'),
    ).toHaveLength(7);
    cleanup();
    expect(
      render(<WeatherComponent {...props('current')} />).getByText('Fog'),
    ).toBeTruthy();
  });

  it.each([
    'current',
    'hourly',
    'weekly',
  ] as const)('shows loading and error notices without replacing the prior %s view', (variant) => {
    storeState = {
      ...storeState,
      loadingLocation: 'Tokyo',
      error: 'Could not load weather for "Tokyo".',
    };
    const { container } = render(<WeatherComponent {...props(variant)} />);
    expect(container.textContent).toContain('Loading weather for Tokyo');
    expect(container.textContent).toContain(
      'Could not load weather for "Tokyo".',
    );
    expect(container.textContent).toContain('Paris, France');
    expect(container.textContent).toContain(
      variant === 'weekly' ? '20°' : '18°',
    );
  });

  it('starts the default refresh once per mount while the singleton deduplicates it', () => {
    const first = render(<WeatherComponent {...props('current')} />);
    first.unmount();
    render(<WeatherComponent {...props('current')} />);
    expect(refreshDefault).toHaveBeenCalledTimes(2);
  });

  it('registers weather actions for the instance', () => {
    render(<WeatherComponent {...props('weekly')} />);
    expect(useActions).toHaveBeenCalledWith(
      'weather',
      'weather-test-weekly',
      weatherActionRunner,
    );
  });
});

describe('weatherActionRunner', () => {
  it('returns ok only after the location and forecast load succeeds', async () => {
    let finish: (() => void) | undefined;
    setLocation.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let settled = false;
    const resultPromise = weatherActionRunner
      .setLocation({ location: 'Paris' })
      .then((result) => {
        settled = true;
        return result;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish?.();
    expect(isOk(await resultPromise)).toBe(true);
  });

  it('returns an intent-focused error when location loading fails', async () => {
    setLocation.mockRejectedValue(new Error('offline'));
    const result = await weatherActionRunner.setLocation({ location: 'Paris' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe(
        'Could not set weather location to "Paris".',
      );
    }
  });
});
