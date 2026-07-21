import { nanoid } from 'nanoid';
import { useSyncExternalStore } from 'react';
import { findByFuzzyTitle } from './find-by-fuzzy-title';

export interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  location?: string;
}

interface CalendarState {
  events: CalendarEvent[];
}

// Today's schedule only — the month/week fixtures for other days
// (`calendar.component.tsx`'s `EVENTS`) are display-only and never mutated
// by actions, so they stay as hardcoded constants outside this store.
const SEED_EVENTS: CalendarEvent[] = [
  { id: '1', time: '7:30', title: 'Gym' },
  {
    id: '2',
    time: '10:00',
    title: 'Design review',
    location: 'Studio Vortex HQ',
  },
  { id: '3', time: '16:00', title: 'Sprint planning' },
];

let state: CalendarState = { events: SEED_EVENTS };

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CalendarState {
  return state;
}

function setState(next: CalendarState): void {
  state = next;
  for (const l of listeners) l();
}

export function useCalendarStore(): CalendarState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getCalendarSnapshot(): CalendarState {
  return state;
}

// Test-only: restores the module-singleton store to its seeded state so
// specs don't leak mutations into one another.
export function resetCalendarStore(): void {
  setState({ events: SEED_EVENTS.map((e) => ({ ...e })) });
}

// The `addEvent`/`moveEvent` actions ask the LLM for "time like 9:00 or
// 14:30" (the 24-hour format `calendar.component.tsx`'s day-view hour slots
// use for exact-string matching), but the LLM sometimes answers with a
// 12-hour "9:00 AM" instead. Without normalizing, that event would silently
// never render in the day view despite being in the store. Best-effort: only
// rewrites strings that parse as `H:MM[ AM|PM]`, passes anything else through
// unchanged so a genuinely unexpected format still shows up as-is somewhere
// rather than being dropped.
function normalizeTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!match) return time.trim();
  const [, hourStr, minute, meridiem] = match;
  let hour = Number(hourStr);
  if (meridiem) {
    if (hour < 1 || hour > 12) return time.trim();
    const isPm = meridiem.toUpperCase() === 'PM';
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }
  return `${hour}:${minute}`;
}

export const calendarActions = {
  addEvent(title: string, time: string): void {
    setState({
      events: [
        ...state.events,
        { id: nanoid(), title, time: normalizeTime(time) },
      ],
    });
  },
  removeEvent(title: string): boolean {
    const match = findByFuzzyTitle(state.events, title);
    if (!match) return false;
    setState({
      events: state.events.filter((e) => e.id !== match.id),
    });
    return true;
  },
  moveEvent(title: string, time: string): boolean {
    const match = findByFuzzyTitle(state.events, title);
    if (!match) return false;
    setState({
      events: state.events.map((e) =>
        e.id === match.id ? { ...e, time: normalizeTime(time) } : e,
      ),
    });
    return true;
  },
};
