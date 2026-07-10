import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { VesselCard } from '../components/vessel-card';
import { m } from '../lib/maelstrom';
import {
  calendarActions,
  getCalendarSnapshot,
  useCalendarStore,
  type CalendarEvent,
} from './calendar.store';
import type { calendarVessel } from './calendar.vessel';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Display-only fixtures for non-today days in the week view — never
// mutated by actions, unlike today's events (see `calendar.store.ts`).
const EVENTS: Record<
  string,
  { time: string; title: string; color: string }[]
> = {
  Mon: [{ time: '9:00', title: 'Team standup', color: '#0066ff' }],
  Tue: [],
  Wed: [
    { time: '14:00', title: 'Design review', color: '#00f0ff' },
    { time: '16:00', title: 'Sprint planning', color: '#6b00ff' },
  ],
  Thu: [{ time: '10:00', title: '1:1 with lead', color: '#0066ff' }],
  Fri: [{ time: '15:00', title: 'Demo day', color: '#00f0ff' }],
  Sat: [],
  Sun: [],
};

const DAY_HOURS = [
  '7:30',
  '8:00',
  '9:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
];

const EVENT_COLORS = ['#0066ff', '#00f0ff', '#6b00ff'];

function noMatchError(title: string): Error {
  const available = getCalendarSnapshot()
    .events.map((e) => `"${e.title}"`)
    .join(', ');
  return new Error(`No event matches "${title}". Available: ${available}`);
}

function eventLabel(event: CalendarEvent): string {
  return event.location ? `${event.title} — ${event.location}` : event.title;
}

// DAY_HOURS are fixed slot labels ('7:30', '8:00', '9:00', ...), but actions
// accept any "H:MM" time (the vessel description advertises "14:30"). Slot by
// hour so an event at "9:30" still renders — in the "9:00" block — rather
// than being silently dropped by an exact-string match against the slots.
function hourOf(time: string): number {
  return Number(time.split(':')[0]);
}

// The day view only renders DAY_HOURS' fixed slots (7:30-17:00). An event
// outside that window would match no slot and vanish here while still
// showing in the week view's today column, so clamp its hour into the
// slot range and let it land in the first/last slot instead of disappearing.
function clampHourToDayView(hour: number): number {
  const first = hourOf(DAY_HOURS[0]);
  const last = hourOf(DAY_HOURS[DAY_HOURS.length - 1]);
  if (hour < first) return first;
  if (hour > last) return last;
  return hour;
}

// addEvent appends, so store order isn't display order — sort by clock
// time whenever events render together.
function sortByTime<T extends { time: string }>(items: T[]): T[] {
  const minutesOf = (time: string) => {
    const [h, m] = time.split(':');
    return Number(h) * 60 + Number(m ?? 0);
  };
  return [...items].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
}

export default function CalendarComponent({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof calendarVessel>) {
  const variant = variantProps.variant;
  const { events } = useCalendarStore();
  const eventColors = new Map(
    events.map((e, i) => [e.id, EVENT_COLORS[i % EVENT_COLORS.length]]),
  );

  m.useActions('calendar', instanceId, {
    addEvent: async ({ title, time }) => {
      calendarActions.addEvent(title, time);
      return ok(undefined);
    },
    removeEvent: async ({ title }) => {
      if (!calendarActions.removeEvent(title)) return err(noMatchError(title));
      return ok(undefined);
    },
    moveEvent: async ({ title, time }) => {
      if (!calendarActions.moveEvent(title, time)) {
        return err(noMatchError(title));
      }
      return ok(undefined);
    },
  });

  if (variant === 'week') {
    const todayIdx = new Date().getDay();
    // getDay() returns 0=Sun, convert to Mon=0 index
    const todayMonIdx = todayIdx === 0 ? 6 : todayIdx - 1;

    return (
      <VesselCard accent="brand" label="Week View" meta="This Week">
        <div className="flex-1 grid grid-cols-7 gap-1.5">
          {WEEK_DAYS.map((day, i) => {
            const isToday = i === todayMonIdx;
            // Today's column mirrors the same events store the day view
            // reads from, so an add/remove/move shows up consistently
            // across both views. Other days stay on the static fixture.
            const dayEvents = isToday
              ? sortByTime(events).map((e) => ({
                  // Key by the store id, not the array index: sortByTime
                  // re-sorts on every render, so an index key would let React
                  // rebind a node to a different event on reorder.
                  id: e.id,
                  time: e.time,
                  title: eventLabel(e),
                  color: eventColors.get(e.id) ?? EVENT_COLORS[0],
                }))
              : (EVENTS[day] ?? []).map((e) => ({
                  id: `${day}-${e.title}`,
                  time: e.time,
                  title: e.title,
                  color: e.color,
                }));
            return (
              <div
                key={day}
                data-today={isToday || undefined}
                className="flex flex-col gap-1.5 min-w-0"
              >
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
                  {dayEvents.map((event) => (
                    <div
                      key={event.id}
                      className="px-1.5 py-1 rounded"
                      style={{
                        background: `${event.color}15`,
                        borderLeft: `2px solid ${event.color}60`,
                      }}
                    >
                      <div className="text-[11px] text-white/80 truncate">
                        {event.title}
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {event.time}
                      </div>
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
      <VesselCard accent="brand" label="Day View" meta="Today">
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {DAY_HOURS.map((hour) => {
            const slotEvents = sortByTime(
              events.filter(
                (e) => clampHourToDayView(hourOf(e.time)) === hourOf(hour),
              ),
            );
            return (
              <div key={hour} className="flex items-center gap-3 py-1.5">
                <span className="text-xs text-gray-500 font-mono w-[44px] shrink-0 text-right">
                  {hour}
                </span>
                {slotEvents.length > 0 ? (
                  <div className="flex-1 space-y-1">
                    {slotEvents.map((event) => (
                      <div
                        key={event.id}
                        className="px-3 py-2 rounded-lg"
                        style={{
                          background: `${eventColors.get(event.id) ?? EVENT_COLORS[0]}12`,
                          borderLeft: `2px solid ${eventColors.get(event.id) ?? EVENT_COLORS[0]}60`,
                        }}
                      >
                        <div className="text-sm text-white/80">
                          {eventLabel(event)}
                        </div>
                        <div className="text-[10px] text-gray-500 font-mono">
                          {event.time}
                        </div>
                      </div>
                    ))}
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
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
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
      accent="brand"
      label={`${monthNames[today.getMonth()]} ${today.getFullYear()}`}
      meta="Calendar"
    >
      <div className="flex-1 flex flex-col">
        <div className="grid grid-cols-7 gap-1 text-xs text-gray-500 mb-2">
          {dayNames.map((day) => (
            <div key={day} className="text-center font-mono">
              {day}
            </div>
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
