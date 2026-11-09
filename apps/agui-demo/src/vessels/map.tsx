import { MapView } from '@maelstrom-co/demo-vessels/vessels/map.component';
import type { TypedVesselProps } from '@maelstrom-co/react';

import { useWorkspace } from '../browser/workspace-state';
import type { mapVessel } from './definitions';

export default function MapPanel({
  variantProps,
}: TypedVesselProps<typeof mapVessel>) {
  const { state } = useWorkspace();
  return <MapView variant={variantProps.variant} state={state.map} />;
}
