import type { ReactNode } from 'react';

interface VesselCardProps {
  accent: string;
  label: string;
  meta?: string;
  children: ReactNode;
}

export default function VesselCard({ accent, label, meta, children }: VesselCardProps) {
  return (
    <div
      className="h-full overflow-hidden relative"
      style={{
        background: `linear-gradient(135deg, ${accent}1a, ${accent}0d)`,
        borderRadius: '12px',
        border: `1px solid ${accent}26`,
      }}
    >
      <div
        className="absolute top-0 inset-x-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}26, transparent)` }}
      />
      <div className="p-4 h-full flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div
            className="text-[10px] font-mono tracking-wider uppercase"
            style={{ color: `${accent}e6` }}
          >
            {label}
          </div>
          {meta && (
            <div className="text-[9px] text-text-muted/40 font-mono">{meta}</div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
