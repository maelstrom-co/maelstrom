import { WeatherView } from '@maelstrom-co/demo-vessels/vessels/weather.component';
import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { useEffect } from 'react';

import { m } from '../lib/maelstrom';
import { useWeatherStore, weatherStore } from './weather.store';
import type { weatherVessel } from './weather.vessel';

export const weatherActionRunner = {
  // The Chart owns view changes; these Actions have no separate data effect.
  showCurrent: () => ok(undefined),
  showHourly: () => ok(undefined),
  showWeekly: () => ok(undefined),
  setLocation: async ({ location }: { location?: unknown }) => {
    if (typeof location !== 'string')
      return err(new Error('Weather location must be a string.'));
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
  const state = useWeatherStore();
  m.useActions('weather', instanceId, weatherActionRunner);
  useEffect(() => {
    weatherStore.refreshDefault().catch(() => {
      // The store retains the fallback and exposes the failure in the vessel.
    });
  }, []);
  return <WeatherView variant={variantProps.variant} state={state} />;
}
