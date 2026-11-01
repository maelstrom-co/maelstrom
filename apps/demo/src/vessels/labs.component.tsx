import type { TypedVesselProps } from '@maelstrom-co/react';
import { useMemo } from 'react';
import { VesselCard } from '../components/vessel-card';
import { m } from '../lib/maelstrom';
import { createLabsActionRunner, useLabsSelection } from './labs.store';
import type { labsVessel } from './labs.vessel.def';

const labels = {
  hemoglobin: 'Hemoglobin',
  platelets: 'Platelets',
  glucose: 'Glucose',
};

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

  return (
    <VesselCard
      accent="brand-3"
      label={variantProps.variant === 'list' ? 'Labs — List' : 'Labs — Trends'}
      meta="Demo only"
    >
      <div className="flex-1 space-y-2 overflow-y-auto text-sm text-ink-2">
        <p>Selected marker: {marker ? labels[marker] : 'None'}</p>
        <p role="status">No lab results available</p>
        <p className="text-xs text-ink-3">
          No trend data or medical advice. Selection changes only the marker
          label.
        </p>
      </div>
    </VesselCard>
  );
}
