import type { TypedVesselProps } from '@maelstrom-co/react';
import type { appointmentsVessel } from './appointments.vessel';

const BASE: [string, string, boolean][] = [
  ['Dr. Sarah Chen', 'Annual Physical · Mar 15, 9:00 AM', true],
  ['Cardiology', 'Follow-up · Mar 22, 2:00 PM', false],
];
const EXTRA: [string, string, boolean][] = [
  ['Lab Work', 'Fasting panel · Apr 2, 8:00 AM', false],
  ['Dr. Patel', 'Dermatology · Apr 10, 11:00 AM', false],
];

export default function AppointmentsComponent({
  variantProps,
}: TypedVesselProps<typeof appointmentsVessel>) {
  const big = variantProps.variant === 'big';
  const items = big ? [...BASE, ...EXTRA] : BASE;
  return (
    <div className="vessel">
      <div className="vessel-head">
        <span className="vessel-title">APPOINTMENTS</span>
      </div>
      <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        {items.map(([title, info, hl]) => (
          <div
            key={title}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: hl ? 'rgba(0,145,255,0.10)' : 'transparent',
              border: hl
                ? '1px solid rgba(0,145,255,0.35)'
                : '1px solid transparent',
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: hl ? '#fff' : 'var(--text)',
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-2)',
                marginTop: 2,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {info}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
