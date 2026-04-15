import type { TypedVesselProps } from '@maelstrom-co/react';

import type { calendarVessel } from './calendar.vessel';
import VesselCard from './VesselCard';

const EVENTS = [
  { time: '9:00', title: 'Team standup', duration: '30m', color: '#0066ff' },
  { time: '14:00', title: 'Design review', duration: '1h', color: '#00f0ff' },
  { time: '16:00', title: 'Sprint planning', duration: '45m', color: '#6b00ff' },
];

export default function CalendarComponent({ variantProps }: TypedVesselProps<typeof calendarVessel>) {
  const isWeek = variantProps.variant === 'week';
  const visibleEvents = isWeek ? EVENTS : EVENTS.slice(0, 2);

  return (
    <VesselCard accent="#0066ff" label={isWeek ? 'Week View' : 'Calendar'} meta="Today">
      {/* Timeline */}
      <div className="flex-1 relative">
        {/* Vertical timeline line */}
        <div className="absolute left-[18px] top-1 bottom-1 w-px" style={{ background: 'linear-gradient(to bottom, rgba(0, 102, 255, 0.15), transparent)' }} />

        <div className="space-y-2.5">
          {visibleEvents.map((event, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 ${i >= 2 ? 'animate-fade-in' : ''}`}
            >
              {/* Time + dot */}
              <div className="flex flex-col items-center shrink-0 w-[38px]">
                <span className="text-[10px] text-text-muted/60 font-mono">{event.time}</span>
                <div
                  className="w-1.5 h-1.5 rounded-full mt-1 relative z-10"
                  style={{
                    background: event.color,
                    boxShadow: `0 0 6px ${event.color}60`,
                  }}
                />
              </div>
              {/* Event card */}
              <div
                className="flex-1 px-2.5 py-1.5 rounded-lg min-w-0"
                style={{
                  background: `${event.color}10`,
                  borderLeft: `2px solid ${event.color}50`,
                }}
              >
                <div className="text-[11px] text-text/80 truncate">{event.title}</div>
                <div className="text-[9px] text-text-muted/50 font-mono mt-0.5">{event.duration}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </VesselCard>
  );
}
