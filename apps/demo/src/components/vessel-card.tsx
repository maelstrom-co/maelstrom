import type { CSSProperties, ReactNode } from 'react';
import { ACCENT_HEX, accentAlpha, type AccentToken } from '../lib/design-tokens';
import { cn } from '../lib/cn';

interface VesselCardProps {
  accent: AccentToken;
  label: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}

export function VesselCard({
  accent,
  label,
  meta,
  children,
  className,
}: VesselCardProps) {
  const hex = ACCENT_HEX[accent];
  const style = {
    '--accent': hex,
    '--edge': accentAlpha(hex, 0.35),
    '--glow': accentAlpha(hex, 0.22),
  } as CSSProperties;

  return (
    <div className={cn('vessel-card relative h-full overflow-hidden', className)} style={style}>
      <div className="vessel-card-edge absolute top-0 inset-x-0 h-px" />
      <div className="p-5 h-full flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-2">
            <span className="vessel-card-dot h-[5px] w-[5px] rounded-full shrink-0" />
            <span className="text-xs font-mono tracking-[.16em] uppercase text-ink-2">
              {label}
            </span>
          </span>
          {meta && (
            <span className="text-xs font-mono text-ink-3 leading-none">{meta}</span>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
