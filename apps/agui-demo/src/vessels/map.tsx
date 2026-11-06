import { MapView } from '@maelstrom-co/demo-vessels/vessels/map.component';
import type { TypedVesselProps } from '@maelstrom-co/react';

import { m } from '../browser/maelstrom';
import { useWorkspace } from '../browser/workspace-state';
import type { mapVessel } from './definitions';

export default function MapPanel({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof mapVessel>) {
  const { store, state } = useWorkspace();
  m.useActions('map', instanceId, {
    showOverview: () =>
      store.action(instanceId, 'showOverview', () => store.update({ map: {} })),
    showRoute: ({ destination }) =>
      store.action(instanceId, 'showRoute', () => store.routeTo(destination)),
    focusLocation: ({ name }) =>
      store.action(instanceId, 'focusLocation', () =>
        store.focusLocation(name),
      ),
  });
  return <MapView variant={variantProps.variant} state={state.map} />;
}
