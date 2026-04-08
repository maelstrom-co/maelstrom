import type { VesselComponentProps } from '@maelstrom-co/react-old';
import { VesselCard } from '../components/vessel-card';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const EVENTS: Record<string, { time: string; title: string; duration: string; color: string }[]> = {
  Mon: [{ time: '9:00', title: 'Team standup', duration: '30m', color: '#0066ff' }],
  Tue: [],
  Wed: [
    { time: '14:00', title: 'Design review', duration: '1h', color: '#00f0ff' },
    { time: '16:00', title: 'Sprint planning', duration: '45m', color: '#6b00ff' },
  ],
  Thu: [{ time: '10:00', title: '1:1 with lead', duration: '30m', color: '#0066ff' }],
  Fri: [{ time: '15:00', title: 'Demo day', duration: '1h', color: '#00f0ff' }],
  Sat: [],
  Sun: [],
};

const TODAY_EVENTS = [
  { time: '9:00', title: 'Team standup', duration: '30m', color: '#0066ff' },
  { time: '14:00', title: 'Design review', duration: '1h', color: '#00f0ff' },
  { time: '16:00', title: 'Sprint planning', duration: '45m', color: '#6b00ff' },
];

const DAY_HOURS = ['8:00', '9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

export default function CalendarComponent({ instance }: VesselComponentProps) {
  const variant = instance.variant;

  if (variant === 'week') {
    const todayIdx = new Date().getDay();
    // getDay() returns 0=Sun, convert to Mon=0 index
    const todayMonIdx = todayIdx === 0 ? 6 : todayIdx - 1;

    return (
      <VesselCard accent="blue" label="Week View" meta="This Week">
        <div className="flex-1 grid grid-cols-7 gap-1.5">
          {WEEK_DAYS.map((day, i) => {
            const dayEvents = EVENTS[day] ?? [];
            const isToday = i === todayMonIdx;
            return (
              <div key={day} className="flex flex-col gap-1.5 min-w-0">
                <div
                  className={
                    isToday
                      ? 'text-xs font-mono text-center font-bold text-blue-accent'
                      : 'text-xs font-mono text-center text-gray-500'
                  }
                >
                  {day}
                </div>
                <div
                  className={
                    isToday
                      ? 'flex-1 rounded-lg bg-blue-accent/8 p-1.5 space-y-1'
                      : 'flex-1 rounded-lg bg-white/[0.02] p-1.5 space-y-1'
                  }
                >
                  {dayEvents.map((event, j) => (
                    <div
                      key={j}
                      className="px-1.5 py-1 rounded"
                      style={{
                        background: `${event.color}15`,
                        borderLeft: `2px solid ${event.color}60`,
                      }}
                    >
                      <div className="text-[11px] text-white/80 truncate">{event.title}</div>
                      <div className="text-[10px] text-gray-500 font-mono">{event.time}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </VesselCard>
    );
  }

  if (variant === 'day') {
    return (
      <VesselCard accent="blue" label="Day View" meta="Today">
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {DAY_HOURS.map((hour) => {
            const event = TODAY_EVENTS.find((e) => e.time === hour);
            return (
              <div key={hour} className="flex items-center gap-3 py-1.5">
                <span className="text-xs text-gray-500 font-mono w-[44px] shrink-0 text-right">
                  {hour}
                </span>
                {event ? (
                  <div
                    className="flex-1 px-3 py-2 rounded-lg"
                    style={{
                      background: `${event.color}12`,
                      borderLeft: `2px solid ${event.color}60`,
                    }}
                  >
                    <div className="text-sm text-white/80">{event.title}</div>
                    <div className="text-xs text-gray-500 font-mono mt-0.5">{event.duration}</div>
                  </div>
                ) : (
                  <div className="flex-1 h-px bg-white/5" />
                )}
              </div>
            );
          })}
        </div>
      </VesselCard>
    );
  }

  // Month view (default)
  const today = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDay = firstDay.getDay();

  const days: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  return (
    <VesselCard
      accent="blue"
      label={`${monthNames[today.getMonth()]} ${today.getFullYear()}`}
      meta="Calendar"
    >
      <div className="flex-1 flex flex-col">
        <div className="grid grid-cols-7 gap-1 text-xs text-gray-500 mb-2">
          {dayNames.map((day) => (
            <div key={day} className="text-center font-mono">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 flex-1">
          {days.map((day, i) => (
            <div
              key={day ?? `empty-${i}`}
              className={
                day === today.getDate()
                  ? 'flex items-center justify-center text-sm rounded-lg bg-blue-accent/20 text-white font-bold'
                  : day
                    ? 'flex items-center justify-center text-sm rounded-lg bg-white/[0.03] text-gray-300 hover:bg-white/[0.06]'
                    : ''
              }
            >
              {day}
            </div>
          ))}
        </div>
      </div>
    </VesselCard>
  );
}
