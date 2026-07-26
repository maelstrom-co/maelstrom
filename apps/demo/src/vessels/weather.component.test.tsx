// @vitest-environment happy-dom

import type { TypedVesselProps } from '@maelstrom-co/react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveWeather, type LiveWeather } from '../lib/weather-data';
import WeatherComponent from './weather.component';
import type { weatherVessel } from './weather.vessel';

const FLAT_WEATHER: LiveWeather = vi.hoisted(() => ({
  current: { temperatureF: 55, weatherCode: 45, windMph: 10 },
  hourly: Array.from({ length: 12 }, (_, i) => ({
    hour: `${i + 1}AM`,
    temperatureF: 55,
    weatherCode: 45,
  })),
  daily: Array.from({ length: 7 }, (_, i) => ({
    day: `D${i}`,
    highF: 55,
    lowF: 55,
    weatherCode: 45,
  })),
}));

vi.mock('../lib/weather-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/weather-data')>();
  return {
    ...actual,
    fetchLiveWeather: vi.fn().mockResolvedValue(FLAT_WEATHER),
  };
});

afterEach(cleanup);

function hourlyProps(): TypedVesselProps<typeof weatherVessel> {
  return {
    instanceId: 'weather-test',
    variantProps: { variant: 'hourly' },
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof weatherVessel>;
}

describe('hourly variant with a flat temperature curve', () => {
  it('renders every bar with a visible nonzero height', async () => {
    const { container, findAllByText } = render(
      <WeatherComponent {...hourlyProps()} />,
    );
    // 12 identical hourly temps only appear once the mocked live data lands.
    expect(await findAllByText('55°')).toHaveLength(13);

    const bars = Array.from(container.querySelectorAll('div')).filter((div) =>
      div.style.height.endsWith('%'),
    );
    expect(bars).toHaveLength(12);
    for (const bar of bars) {
      expect(Number.parseFloat(bar.style.height)).toBeGreaterThan(0);
    }
  });
});

function currentProps(): TypedVesselProps<typeof weatherVessel> {
  return {
    instanceId: 'weather-test-current',
    variantProps: { variant: 'current' },
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof weatherVessel>;
}

describe('useLiveWeather cancellation', () => {
  it('aborts the in-flight fetch on unmount instead of merely ignoring it', async () => {
    const mockFetch = vi.mocked(fetchLiveWeather);
    mockFetch.mockClear();

    const { unmount } = render(<WeatherComponent {...currentProps()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [, , , signal] = mockFetch.mock.calls[0] as [
      number,
      number,
      typeof fetch,
      AbortSignal,
    ];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
  });
});
