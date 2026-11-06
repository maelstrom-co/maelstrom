import { LabsView } from '@maelstrom-co/demo-vessels/vessels/labs.component';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { useMemo } from 'react';

import { m } from '../lib/maelstrom';
import { createLabsActionRunner, useLabsSelection } from './labs.store';
import type { labsVessel } from './labs.vessel.def';

export default function LabsComponent({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof labsVessel>) {
  const marker = useLabsSelection(instanceId);
  const runner = useMemo(
    () => createLabsActionRunner(instanceId),
    [instanceId],
  );
  m.useActions('labs', instanceId, runner);
  return <LabsView variant={variantProps.variant} marker={marker} />;
}
