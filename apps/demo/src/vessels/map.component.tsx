import { MapView } from '@maelstrom-co/demo-vessels/vessels/map.component';
import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { useEffect } from 'react';

import {
  DEMO_LOCATIONS,
  findLocationByFuzzyName,
  HOME,
} from '../lib/locations';
import { m } from '../lib/maelstrom';
import { fetchRoute } from '../lib/osrm';
import { mapActions, useMapStore } from './map.store';
import type { mapVessel } from './map.vessel';

function noMatchError(name: string): Error {
  const available = DEMO_LOCATIONS.map((loc) => `"${loc.name}"`).join(', ');
  return new Error(`No location matches "${name}". Available: ${available}`);
}

/** Native demo Actions acknowledge destination selection before route retrieval. */
export const mapActionRunner = {
  showRoute: async ({ destination }: { destination: string }) => {
    const match = findLocationByFuzzyName(destination);
    if (!match) return err(noMatchError(destination));
    mapActions.showRoute(match);
    return ok(undefined);
  },
  showOverview: async () => {
    mapActions.showOverview();
    return ok(undefined);
  },
  focusLocation: async ({ name }: { name: string }) => {
    const match = findLocationByFuzzyName(name);
    if (!match) return err(noMatchError(name));
    mapActions.focusLocation(match);
    return ok(undefined);
  },
};

export default function MapComponent({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof mapVessel>) {
  const state = useMapStore();
  const variant = variantProps.variant;
  m.useActions('map', instanceId, mapActionRunner);
  useEffect(() => {
    if (variant !== 'route' || !state.destination || state.route) return;
    const destination = state.destination;
    let cancelled = false;
    fetchRoute(HOME, destination)
      .then((route) => {
        if (!cancelled) mapActions.setRoute(route);
      })
      .catch(() => {
        // Graceful degradation: keep the destination card, no route line.
      });
    return () => {
      cancelled = true;
    };
  }, [variant, state]);
  return <MapView variant={variant} state={state} />;
}
