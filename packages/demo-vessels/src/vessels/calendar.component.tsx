import { VesselCard } from '../components/vessel-card';
import {
  ACCENT_HEX,
  CALENDAR_EVENT_ACCENTS,
  VESSEL_ACCENTS,
} from '../lib/design-tokens';
import type { CalendarEventView } from '../view-data';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

function eventLabel(event: CalendarEventView): string {
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
function sortByTime<T extends { time: string }>(items: readonly T[]): T[] {
  const minutesOf = (time: string) => {
    const [h, m] = time.split(':');
    return Number(h) * 60 + Number(m ?? 0);
  };
  return [...items].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
}

/** Render app-selected calendar records without owning mutations or fixtures. */
export function CalendarView({
  variant,
  events,
  weekEvents = {},
  today = new Date(),
}: {
  /** Chart-selected view. */
  variant: 'month' | 'week' | 'day';
  /** Events for the displayed day. */
  events: readonly CalendarEventView[];
  /** Events for other days, indexed by Mon through Sun. */
  weekEvents?: Readonly<Record<string, readonly CalendarEventView[]>>;
  /** Calendar date used for the displayed month and day marker. */
  today?: Date;
}) {
  const eventColors = new Map(
    events.map((e, i) => [
      e.id,
      ACCENT_HEX[CALENDAR_EVENT_ACCENTS[i % CALENDAR_EVENT_ACCENTS.length]],
    ]),
  );

  if (variant === 'week') {
    const todayIdx = today.getDay();
    // getDay() returns 0=Sun, convert to Mon=0 index
    const todayMonIdx = todayIdx === 0 ? 6 : todayIdx - 1;

    return (
      <VesselCard
        accent={VESSEL_ACCENTS.calendar}
        label="Week View"
        meta="This Week"
      >
        <div className="flex-1 grid grid-cols-7 gap-1.5">
          {WEEK_DAYS.map((day, i) => {
            const isToday = i === todayMonIdx;
            const dayEvents = isToday
              ? sortByTime(events).map((e) => ({
                  // Key by the store id, not the array index: sortByTime
                  // re-sorts on every render, so an index key would let React
                  // rebind a node to a different event on reorder.
                  id: e.id,
                  time: e.time,
                  title: eventLabel(e),
                  color: eventColors.get(e.id) ?? ACCENT_HEX.brand,
                }))
              : (weekEvents[day] ?? []).map((e) => ({
                  id: e.id,
                  time: e.time,
                  title: eventLabel(e),
                  color: ACCENT_HEX[e.accent ?? 'brand'],
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
                      ? 'flex items-center justify-center gap-1 text-xs font-mono text-center font-bold text-brand'
                      : 'text-xs font-mono text-center text-ink-3'
                  }
                >
                  {isToday && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-brand"
                      style={{ boxShadow: '0 0 8px var(--color-brand)' }}
                    />
                  )}
                  {day}
                </div>
                <div
                  className={
                    isToday
                      ? 'flex-1 rounded-lg bg-brand/8 p-1.5 space-y-1'
                      : 'flex-1 rounded-lg bg-white/[0.02] p-1.5 space-y-1'
                  }
                >
                  {dayEvents.map((event) => (
                    <div
                      key={event.id}
                      className="px-1.5 py-1 rounded bg-white/[0.03]"
                      style={{ borderLeft: `2px solid ${event.color}` }}
                    >
                      <div className="text-xs text-ink truncate">
                        {event.title}
                      </div>
                      <div className="text-xs text-ink-3 font-mono leading-none">
                        {event.time}
                      </div>
                    </div>
                  ))}
                  {isToday && dayEvents.length === 0 && (
                    <div className="flex flex-col items-center gap-0.5 text-center py-2">
                      <p className="text-xs text-ink-3">Nothing scheduled</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </VesselCard>
    );
  }

  if (variant === 'day') {
    if (events.length === 0) {
      return (
        <VesselCard
          accent={VESSEL_ACCENTS.calendar}
          label="Day View"
          meta="Today"
        >
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-1">
            <p className="text-sm text-ink-3">Nothing scheduled</p>
            <p className="text-xs font-mono text-ink-3">
              Try: &ldquo;Add an event, coffee with Sam at 9&rdquo;
            </p>
          </div>
        </VesselCard>
      );
    }

    return (
      <VesselCard
        accent={VESSEL_ACCENTS.calendar}
        label="Day View"
        meta="Today"
      >
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {DAY_HOURS.map((hour) => {
            const slotEvents = sortByTime(
              events.filter(
                (e) => clampHourToDayView(hourOf(e.time)) === hourOf(hour),
              ),
            );
            return (
              <div key={hour} className="flex items-center gap-3 py-1.5">
                <span className="text-xs text-ink-3 font-mono w-[44px] shrink-0 text-right">
                  {hour}
                </span>
                {slotEvents.length > 0 ? (
                  <div className="flex-1 space-y-1">
                    {slotEvents.map((event) => (
                      <div
                        key={event.id}
                        className="px-3 py-2 rounded-lg bg-white/[0.03]"
                        style={{
                          borderLeft: `2px solid ${eventColors.get(event.id) ?? ACCENT_HEX.brand}`,
                        }}
                      >
                        <div className="text-sm text-ink">
                          {eventLabel(event)}
                        </div>
                        <div className="text-xs text-ink-3 font-mono leading-none">
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
      accent={VESSEL_ACCENTS.calendar}
      label={`${monthNames[today.getMonth()]} ${today.getFullYear()}`}
      meta="Calendar"
    >
      <div className="flex-1 flex flex-col">
        <div className="grid grid-cols-7 gap-1 text-xs text-ink-3 mb-2">
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
                  ? 'relative flex items-center justify-center text-sm rounded-lg bg-brand/8 text-ink font-bold'
                  : day
                    ? 'flex items-center justify-center text-sm rounded-lg bg-white/[0.03] text-ink-2 hover:bg-white/[0.06]'
                    : ''
              }
            >
              {day}
              {day === today.getDate() && (
                <span
                  className="absolute top-1 right-1 h-1 w-1 rounded-full bg-brand"
                  style={{ boxShadow: '0 0 6px var(--color-brand)' }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </VesselCard>
  );
}
