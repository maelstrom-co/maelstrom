import { beforeEach, describe, expect, it } from 'vitest';
import {
  calendarActions,
  getCalendarSnapshot,
  resetCalendarStore,
} from './calendar.store';

beforeEach(() => {
  resetCalendarStore();
});

describe('calendarActions', () => {
  it('starts seeded with today\'s events', () => {
    expect(getCalendarSnapshot().events.map((e) => e.title)).toEqual([
      'Gym',
      'Design review',
      'Sprint planning',
    ]);
  });

  it('addEvent appends a new event', () => {
    calendarActions.addEvent('Coffee with Sam', '9:00');
    const { events } = getCalendarSnapshot();
    expect(events).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({
      title: 'Coffee with Sam',
      time: '9:00',
    });
  });

  it('addEvent normalizes a 12-hour time to the day view\'s 24-hour format', () => {
    calendarActions.addEvent('Coffee with Sam', '9:00 AM');
    expect(getCalendarSnapshot().events.at(-1)?.time).toBe('9:00');
  });

  it('addEvent normalizes a PM time to 24-hour format', () => {
    calendarActions.addEvent('Retro', '2:00 PM');
    expect(getCalendarSnapshot().events.at(-1)?.time).toBe('14:00');
  });

  it('removeEvent fuzzy-matches a title and removes it', () => {
    const removed = calendarActions.removeEvent('gym');
    expect(removed).toBe(true);
    expect(getCalendarSnapshot().events.map((e) => e.title)).toEqual([
      'Design review',
      'Sprint planning',
    ]);
  });

  it('removeEvent returns false and leaves state untouched on no match', () => {
    const removed = calendarActions.removeEvent('nonexistent event');
    expect(removed).toBe(false);
    expect(getCalendarSnapshot().events).toHaveLength(3);
  });

  it('moveEvent fuzzy-matches a title and updates its time, keeping the title', () => {
    const moved = calendarActions.moveEvent('sprint planning', '17:00');
    expect(moved).toBe(true);
    const match = getCalendarSnapshot().events.find(
      (e) => e.title === 'Sprint planning',
    );
    expect(match?.time).toBe('17:00');
  });

  it('moveEvent returns false and leaves state untouched on no match', () => {
    const moved = calendarActions.moveEvent('nonexistent event', '9:00');
    expect(moved).toBe(false);
    expect(getCalendarSnapshot().events.find((e) => e.time === '9:00')).toBeUndefined();
  });
});
