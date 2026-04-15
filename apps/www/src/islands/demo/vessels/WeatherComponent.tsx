import type { TypedVesselProps } from '@maelstrom-co/react';

import type { weatherVessel } from './weather.vessel';
import VesselCard from './VesselCard';

const DAYS = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon'];
const TEMPS = [68, 71, 75, 72, 69];
const ICONS = ['⛅', '☀️', '☀️', '⛅', '🌤'];
const MIN_TEMP = 64;
const MAX_TEMP = 76;

export default function WeatherComponent({ variantProps }: TypedVesselProps<typeof weatherVessel>) {
  const isFull = variantProps.variant === 'full';

  return (
    <VesselCard accent="#00f0ff" label={isFull ? 'Weather Forecast' : 'Weather'} meta="San Francisco">
      <div className="flex items-center gap-3 mb-auto">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-text tracking-tight" style={{ textShadow: '0 0 20px rgba(0, 240, 255, 0.15)' }}>72°</span>
            <span className="text-[10px] text-text-muted/40">F</span>
          </div>
          <div className="text-[11px] text-cyan/60 mt-0.5">Sunny</div>
          <div className="text-[9px] text-text-muted/30 mt-0.5">H: 75° L: 64°</div>
        </div>
      </div>

      {isFull && (
        <div className="mt-3 animate-fade-in">
          <div className="h-px w-full mb-3" style={{ background: 'linear-gradient(90deg, transparent, rgba(0, 240, 255, 0.08), transparent)' }} />
          <div className="flex items-end gap-1" style={{ height: '70px' }}>
            {TEMPS.map((t, i) => {
              const pct = ((t - MIN_TEMP) / (MAX_TEMP - MIN_TEMP)) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[8px] leading-none">{ICONS[i]}</span>
                  <span className="text-[8px] text-text-muted/50 font-mono">{t}°</span>
                  <div
                    className="w-full rounded-sm"
                    style={{
                      height: `${pct}%`,
                      background: `linear-gradient(to top, rgba(0, 240, 255, ${i === 2 ? '0.3' : '0.15'}), rgba(0, 240, 255, 0.04))`,
                      border: '1px solid rgba(0, 240, 255, 0.12)',
                      boxShadow: i === 2 ? '0 0 8px rgba(0, 240, 255, 0.1)' : 'none',
                    }}
                  />
                  <span className="text-[8px] text-text-muted/30 font-mono">{DAYS[i]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </VesselCard>
  );
}
