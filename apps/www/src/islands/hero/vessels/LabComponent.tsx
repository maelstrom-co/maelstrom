import type { TypedVesselProps } from '@maelstrom-co/react';
import { useId } from 'react';
import type { labVessel } from './lab.vessel';

function prand(n: number) {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}
const round = (n: number) => Math.round(n * 1000) / 1000;

function Sparkline({
  color = '#0091FF',
  seed = 0,
  h = 60,
}: {
  color?: string;
  seed?: number;
  h?: number;
}) {
  // useId keeps the gradient id unique per instance so multiple sparklines
  // don't all resolve to the first via url(#...). Strip ':' so it's a safe
  // URL fragment.
  const gradId = `spark-${useId().replace(/:/g, '')}`;
  const pts: [number, number][] = [];
  let v = 0.5;
  for (let i = 0; i <= 24; i++) {
    v +=
      (Math.sin(i * 0.5 + seed) + (prand(i + seed * 100) - 0.5) * 0.3) * 0.04;
    v = Math.max(0.1, Math.min(0.9, v));
    pts.push([i / 24, 1 - v]);
  }
  const w = 280;
  let d = `M 0 ${round(pts[0][1] * h)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [px, py] = pts[i - 1];
    const cx = ((px + x) / 2) * w;
    d += ` Q ${round(px * w)} ${round(py * h)} ${round(cx)} ${round(((py + y) / 2) * h)}`;
  }
  d += ` T ${w} ${round(pts[pts.length - 1][1] * h)}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: `${h}px` }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gradId})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

export default function LabComponent({
  variantProps,
}: TypedVesselProps<typeof labVessel>) {
  const isMini = variantProps.variant === 'mini';
  return (
    <div className="vessel">
      <div className="vessel-head">
        <span className="vessel-title">LAB RESULTS</span>
        <span className="badge">GLUCOSE</span>
      </div>
      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: 10,
        }}
      >
        <Sparkline color="#0091FF" seed={1.2} h={isMini ? 38 : 70} />
        {!isMini && (
          <div style={{ display: 'flex', gap: 22, marginTop: 6 }}>
            <div>
              <div className="kv-l">Latest</div>
              <div className="kv-v" style={{ color: '#2BD46B' }}>
                94 <span style={{ fontSize: 14 }}>mg/dL</span>
              </div>
            </div>
            <div>
              <div className="kv-l">Range</div>
              <div className="kv-v">65–99</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
