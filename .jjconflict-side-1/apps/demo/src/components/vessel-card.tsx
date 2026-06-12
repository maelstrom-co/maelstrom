import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

type Accent = 'cyan' | 'blue' | 'seafoam' | 'violet';

interface VesselCardProps {
  accent: Accent;
  label: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}

const accentStyles: Record<
  Accent,
  {
    bg: string;
    border: string;
    glow: string;
    text: string;
  }
> = {
  cyan: {
    bg: 'from-cyan-accent/8 to-cyan-accent/4',
    border: 'border-cyan-accent/12',
    glow: 'via-cyan-accent/12',
    text: 'text-cyan-accent/90',
  },
  blue: {
    bg: 'from-blue-accent/8 to-blue-accent/4',
    border: 'border-blue-accent/12',
    glow: 'via-blue-accent/12',
    text: 'text-blue-accent/90',
  },
  seafoam: {
    bg: 'from-seafoam-accent/8 to-seafoam-accent/4',
    border: 'border-seafoam-accent/12',
    glow: 'via-seafoam-accent/12',
    text: 'text-seafoam-accent/90',
  },
  violet: {
    bg: 'from-violet-accent/8 to-violet-accent/4',
    border: 'border-violet-accent/12',
    glow: 'via-violet-accent/12',
    text: 'text-violet-accent/90',
  },
};

export function VesselCard({
  accent,
  label,
  meta,
  children,
  className,
}: VesselCardProps) {
  const styles = accentStyles[accent];

  return (
    <div
      className={cn(
        'relative h-full overflow-hidden rounded-xl border',
        `bg-gradient-to-br ${styles.bg} ${styles.border}`,
        className,
      )}
    >
      {/* Top edge glow */}
      <div
        className={cn(
          'absolute top-0 inset-x-0 h-px',
          `bg-gradient-to-r from-transparent ${styles.glow} to-transparent`,
        )}
      />

      <div className="p-5 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <span
            className={cn(
              'text-xs font-mono tracking-wider uppercase',
              styles.text,
            )}
          >
            {label}
          </span>
          {meta && (
            <span className="text-[11px] text-gray-500 font-mono">{meta}</span>
          )}
        </div>

        {/* Content */}
        {children}
      </div>
    </div>
  );
}
