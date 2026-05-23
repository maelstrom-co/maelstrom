import type { ReactNode } from 'react';
import type { TypedVesselProps } from '@maelstrom-co/react';
import type { vitalsVessel } from './vitals.vessel';

type Metric = { label: string; value: ReactNode };

const BASE: Metric[] = [
  {
    label: 'PULSE',
    value: (
      <>
        72<span style={{ fontSize: 12 }}> bpm</span>
      </>
    ),
  },
  { label: 'BP', value: '125/80' },
];
const EXTRA: Metric[] = [
  {
    label: 'SpO₂',
    value: (
      <>
        98<span style={{ fontSize: 13 }}>%</span>
      </>
    ),
  },
  { label: 'TEMP', value: '98.6°' },
];

export default function VitalsComponent({
  variantProps,
}: TypedVesselProps<typeof vitalsVessel>) {
  const metrics = variantProps.variant === 'wide' ? [...BASE, ...EXTRA] : BASE;
  return (
    <div className="vessel">
      <div className="vessel-head">
        <span className="vessel-title">VITALS</span>
      </div>
      <div
        style={{
          display: 'grid',
          // Auto-fit to the cell width the orchestrator gives us (1 column when
          // narrow, up to 4 when wide) instead of overflowing fixed columns.
          gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
          gap: 10,
          marginTop: 14,
        }}
      >
        {metrics.map((metric) => (
          <div className="stat" key={metric.label}>
            <div className="kv-l" style={{ whiteSpace: 'nowrap' }}>
              {metric.label}
            </div>
            <div className="kv-v" style={{ fontSize: 20 }}>
              {metric.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
