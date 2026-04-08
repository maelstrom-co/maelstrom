import type { VesselComponentProps } from '@maelstrom-co/react-old';
import { VesselCard } from '../components/vessel-card';

const HOURLY = [
  { hour: '9AM', temp: 68, icon: '🌤️' },
  { hour: '12PM', temp: 72, icon: '☀️' },
  { hour: '3PM', temp: 75, icon: '☀️' },
  { hour: '6PM', temp: 70, icon: '🌤️' },
  { hour: '9PM', temp: 65, icon: '🌙' },
];

const WEEKLY = [
  { day: 'Mon', high: 75, low: 58, icon: '☀️' },
  { day: 'Tue', high: 72, low: 55, icon: '🌤️' },
  { day: 'Wed', high: 68, low: 52, icon: '🌧️' },
  { day: 'Thu', high: 70, low: 54, icon: '⛅' },
  { day: 'Fri', high: 73, low: 56, icon: '☀️' },
  { day: 'Sat', high: 76, low: 59, icon: '☀️' },
  { day: 'Sun', high: 74, low: 57, icon: '🌤️' },
];

const MIN_TEMP = 52;
const MAX_TEMP = 76;

export default function WeatherComponent({ instance }: VesselComponentProps) {
  const variant = instance.variant;

  if (variant === 'hourly') {
    return (
      <VesselCard accent="cyan" label="Hourly Forecast" meta="San Francisco">
        <div className="flex items-baseline gap-1 mb-4">
          <span
            className="text-5xl font-bold tracking-tight"
            style={{ textShadow: '0 0 30px rgba(0, 240, 255, 0.15)' }}
          >
            72°
          </span>
          <span className="text-sm text-gray-500">F</span>
        </div>
        <div className="flex-1 flex items-end gap-3">
          {HOURLY.map((h) => {
            const pct = ((h.temp - MIN_TEMP) / (MAX_TEMP - MIN_TEMP)) * 100;
            const isMax = h.temp === 75;
            return (
              <div key={h.hour} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="text-base">{h.icon}</span>
                <span className="text-xs text-gray-400 font-mono">{h.temp}°</span>
                <div
                  className="w-full rounded-sm border border-cyan-accent/10"
                  style={{
                    height: `${pct}%`,
                    background: `linear-gradient(to top, rgba(0, 240, 255, ${isMax ? '0.3' : '0.15'}), rgba(0, 240, 255, 0.04))`,
                    boxShadow: isMax ? '0 0 8px rgba(0, 240, 255, 0.15)' : 'none',
                  }}
                />
                <span className="text-xs text-gray-500 font-mono">{h.hour}</span>
              </div>
            );
          })}
        </div>
      </VesselCard>
    );
  }

  if (variant === 'weekly') {
    return (
      <VesselCard accent="cyan" label="Weekly Forecast" meta="San Francisco">
        <div className="flex-1 grid grid-cols-7 gap-2">
          {WEEKLY.map((d) => (
            <div
              key={d.day}
              className="flex flex-col items-center justify-center gap-1.5 rounded-lg bg-cyan-accent/5 p-2"
            >
              <span className="text-xs text-gray-500 font-mono">{d.day}</span>
              <span className="text-xl">{d.icon}</span>
              <div className="text-sm">
                <span className="text-white font-medium">{d.high}°</span>
                <span className="text-gray-500"> / {d.low}°</span>
              </div>
            </div>
          ))}
        </div>
      </VesselCard>
    );
  }

  // Current (default)
  return (
    <VesselCard accent="cyan" label="Weather" meta="San Francisco">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-5xl mb-3">☀️</div>
        <div className="flex items-baseline gap-1">
          <span
            className="text-6xl font-bold tracking-tight"
            style={{ textShadow: '0 0 30px rgba(0, 240, 255, 0.15)' }}
          >
            72°
          </span>
          <span className="text-sm text-gray-500">F</span>
        </div>
        <div className="text-sm text-cyan-accent/60 mt-1">Sunny</div>
        <div className="text-xs text-gray-500 mt-1">H: 75° L: 64°</div>
        <div className="flex gap-6 mt-4 text-sm text-gray-400">
          <span>💧 45%</span>
          <span>💨 8 mph</span>
        </div>
      </div>
    </VesselCard>
  );
}
