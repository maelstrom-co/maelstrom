import { VesselCard } from '../components/vessel-card';
import type { LabMarkerSlug } from './labs.vessel.def';

const labels = {
  hemoglobin: 'Hemoglobin',
  platelets: 'Platelets',
  glucose: 'Glucose',
};

/** Render the selected demo marker without implying medical data exists. */
export function LabsView({
  variant,
  marker,
}: {
  /** Chart-selected view. */
  variant: 'list' | 'trends';
  /** App-owned marker selection. */
  marker: LabMarkerSlug | null;
}) {
  return (
    <VesselCard
      accent="brand-3"
      label={variant === 'list' ? 'Labs — List' : 'Labs — Trends'}
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
