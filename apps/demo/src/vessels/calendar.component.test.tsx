// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isErr, isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { ACCENT_HEX, CALENDAR_EVENT_ACCENTS } from '../lib/design-tokens';
import type { calendarVessel } from './calendar.vessel';

vi.mock('../lib/maelstrom', () => ({
  m: { useActions: vi.fn() },
}));

const { resetCalendarStore } = await import('./calendar.store');
const { m } = await import('../lib/maelstrom');
const CalendarComponent = (await import('./calendar.component')).default;

type CalendarHandlers = Record<
  string,
  (params: Record<string, string>) => Promise<Result<undefined, Error>>
>;

function props(
  variant: 'month' | 'week' | 'day' = 'day',
): TypedVesselProps<typeof calendarVessel> {
  return {
    instanceId: 'calendar-test',
    variantProps: { variant },
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof calendarVessel>;
}

// `m.useActions` is mocked as a plain vi.fn(), so the handlers object the
// component wires up is only reachable via the mock's recorded call args —
// there is no separate exported action runner (calendar mirrors tasks'
// inline-handler pattern, not map's standalone-runner pattern).
function latestHandlers(): CalendarHandlers {
  const calls = vi.mocked(m.useActions).mock.calls;
  const last = calls.at(-1);
  if (!last) throw new Error('m.useActions was not called');
  return last[2] as CalendarHandlers;
}

beforeEach(() => {
  resetCalendarStore();
  vi.mocked(m.useActions).mockClear();
});

afterEach(cleanup);

describe('calendar action handlers', () => {
  it('addEvent adds an event and returns ok', async () => {
    render(<CalendarComponent {...props()} />);
    const handlers = latestHandlers();
    const result = await handlers.addEvent({
      title: 'Coffee with Sam',
      time: '9:00',
    });
    expect(isOk(result)).toBe(true);
  });

  it('removeEvent fuzzy-matches a title and returns ok', async () => {
    render(<CalendarComponent {...props()} />);
    const handlers = latestHandlers();
    const result = await handlers.removeEvent({ title: 'gym' });
    expect(isOk(result)).toBe(true);
  });

  it('removeEvent returns err listing available titles on no match', async () => {
    render(<CalendarComponent {...props()} />);
    const handlers = latestHandlers();
    const result = await handlers.removeEvent({ title: 'nonexistent event' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain(
        'No event matches "nonexistent event"',
      );
      expect(result.error.message).toContain('"Gym"');
      expect(result.error.message).toContain('"Design review"');
      expect(result.error.message).toContain('"Sprint planning"');
    }
  });

  it('moveEvent fuzzy-matches a title and returns ok', async () => {
    render(<CalendarComponent {...props()} />);
    const handlers = latestHandlers();
    const result = await handlers.moveEvent({
      title: 'sprint planning',
      time: '17:00',
    });
    expect(isOk(result)).toBe(true);
  });

  it('moveEvent returns err listing available titles on no match', async () => {
    render(<CalendarComponent {...props()} />);
    const handlers = latestHandlers();
    const result = await handlers.moveEvent({
      title: 'nonexistent event',
      time: '9:00',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain(
        'No event matches "nonexistent event"',
      );
    }
  });
});

describe('CalendarComponent day view rendering', () => {
  it('renders an added event at its time slot', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    expect(container.textContent).not.toContain('Coffee with Sam');

    const handlers = latestHandlers();
    await act(async () => {
      await handlers.addEvent({ title: 'Coffee with Sam', time: '9:00' });
    });

    expect(container.textContent).toContain('Coffee with Sam');
  });

  it('renders a 12-hour-formatted event at its normalized 24-hour slot', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    const handlers = latestHandlers();
    await act(async () => {
      await handlers.addEvent({ title: 'Coffee with Sam', time: '9:00 AM' });
    });

    expect(container.textContent).toContain('Coffee with Sam');
  });

  it('drops a removed event from the day view', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    expect(container.textContent).toContain('Gym');

    const handlers = latestHandlers();
    await act(async () => {
      await handlers.removeEvent({ title: 'gym' });
    });

    expect(container.textContent).not.toContain('Gym');
  });

  it('renders an event at a non-slot time inside its hour block, with its exact time visible', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    const handlers = latestHandlers();
    await act(async () => {
      await handlers.addEvent({ title: 'Coffee with Sam', time: '9:30' });
    });

    expect(container.textContent).toContain('Coffee with Sam');
    expect(container.textContent).toContain('9:30');
  });

  it('clamps a late out-of-range event into the last day-view slot', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    const handlers = latestHandlers();
    await act(async () => {
      await handlers.addEvent({ title: 'Design review', time: '19:00' });
    });

    const slots = Array.from(
      container.querySelectorAll('.flex.items-center.gap-3.py-1\\.5'),
    );
    const lastSlot = slots.at(-1) as HTMLElement;
    expect(lastSlot.textContent).toContain('Design review');
    expect(lastSlot.textContent).toContain('19:00');
  });

  it('clamps an early out-of-range event into the first day-view slot', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    const handlers = latestHandlers();
    await act(async () => {
      await handlers.addEvent({ title: 'Early Bird', time: '6:00' });
    });

    const slots = Array.from(
      container.querySelectorAll('.flex.items-center.gap-3.py-1\\.5'),
    );
    const firstSlot = slots[0] as HTMLElement;
    expect(firstSlot.textContent).toContain('Early Bird');
    expect(firstSlot.textContent).toContain('6:00');
  });

  it('leaves in-range events in their own slot, unaffected by clamping', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    expect(container.textContent).toContain('Gym');
    expect(container.textContent).toContain('Design review');
  });

  it('renders events added out of order chronologically within an hour slot', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    const handlers = latestHandlers();
    await act(async () => {
      await handlers.addEvent({ title: 'Later Event', time: '9:45' });
      await handlers.addEvent({ title: 'Earlier Event', time: '9:15' });
    });

    const earlierIdx = container.textContent?.indexOf('Earlier Event') ?? -1;
    const laterIdx = container.textContent?.indexOf('Later Event') ?? -1;
    expect(earlierIdx).toBeGreaterThanOrEqual(0);
    expect(laterIdx).toBeGreaterThanOrEqual(0);
    expect(earlierIdx).toBeLessThan(laterIdx);
  });

  it('shows an empty state on the day view with zero events', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    const handlers = latestHandlers();
    await act(async () => {
      await handlers.removeEvent({ title: 'Gym' });
      await handlers.removeEvent({ title: 'Design review' });
      await handlers.removeEvent({ title: 'Sprint planning' });
    });
    expect(container.textContent).toContain('Nothing scheduled');
  });

  it('cycles each event sliver accent by store index through CALENDAR_EVENT_ACCENTS', () => {
    // Normalize both sides through the DOM's own CSSStyleDeclaration so the
    // comparison doesn't depend on how the engine serializes a hex color.
    function borderLeftFor(hex: string): string {
      const probe = document.createElement('div');
      probe.style.borderLeft = `2px solid ${hex}`;
      return probe.style.borderLeft;
    }

    const { getByText } = render(<CalendarComponent {...props('day')} />);
    const titlesInStoreOrder = [
      'Gym',
      'Design review — Studio Vortex HQ',
      'Sprint planning',
    ];
    titlesInStoreOrder.forEach((title, i) => {
      const accent = CALENDAR_EVENT_ACCENTS[i % CALENDAR_EVENT_ACCENTS.length];
      const sliver = getByText(title).parentElement as HTMLElement;
      expect(sliver.style.borderLeft).toBe(borderLeftFor(ACCENT_HEX[accent]));
    });
  });
});

describe('empty-state onboarding hint truncation', () => {
  it('drops the "Try: ..." hint from the week view\'s today-cell empty state (too narrow to render it) but keeps "Nothing scheduled"', async () => {
    const { container } = render(<CalendarComponent {...props('week')} />);
    const handlers = latestHandlers();
    await act(async () => {
      await handlers.removeEvent({ title: 'Gym' });
      await handlers.removeEvent({ title: 'Design review' });
      await handlers.removeEvent({ title: 'Sprint planning' });
    });
    const todayColumn = container.querySelector('[data-today]') as HTMLElement | null;
    if (todayColumn === null) throw new Error('expected a today column');
    expect(todayColumn.textContent).toContain('Nothing scheduled');
    expect(todayColumn.textContent).not.toContain('Try:');
  });

  it('keeps the "Try: ..." hint on the day view\'s empty state, which has room for it', async () => {
    const { container } = render(<CalendarComponent {...props('day')} />);
    const handlers = latestHandlers();
    await act(async () => {
      await handlers.removeEvent({ title: 'Gym' });
      await handlers.removeEvent({ title: 'Design review' });
      await handlers.removeEvent({ title: 'Sprint planning' });
    });
    expect(container.textContent).toContain('Nothing scheduled');
    expect(container.textContent).toContain('Try:');
  });
});

describe('CalendarComponent week view rendering', () => {
  it("keeps a DOM node attached to its own event across a sortByTime reorder (id-keyed, not index-keyed)", async () => {
    const { container } = render(<CalendarComponent {...props('week')} />);
    const handlers = latestHandlers();

    const todayColumn = container.querySelector('[data-today]') as HTMLElement | null;
    if (todayColumn === null) throw new Error('expected a today column');
    const entrySelector = '.px-1\\.5.py-1.rounded';
    // Hold a reference to the actual DOM node currently rendering "Gym" —
    // not a re-query — so we can tell whether React reused that exact node
    // for a different event after the list reorders.
    const gymNodeBefore = todayColumn.querySelector(entrySelector);
    expect(gymNodeBefore?.textContent).toContain('Gym');

    await act(async () => {
      // Adding an event earlier than existing ones forces sortByTime to put
      // it first, pushing Gym to the second slot. With `key={j}` (array
      // index), React reuses the first position's DOM node in place and
      // just patches its text/props — so this exact node would end up
      // showing "Early Add" instead of "Gym". Keying by `event.id` makes
      // React create a new node for the new first entry and leaves Gym's
      // node associated with Gym.
      await handlers.addEvent({ title: 'Early Add', time: '5:00' });
    });

    expect(gymNodeBefore?.textContent).toContain('Gym');
    expect(gymNodeBefore?.isConnected).toBe(true);
  });

  it('renders today\'s events chronologically even when added out of order', async () => {
    const { container } = render(<CalendarComponent {...props('week')} />);
    const handlers = latestHandlers();
    await act(async () => {
      // Seeded events are 7:30 Gym, 10:00 Design review, 16:00 Sprint
      // planning — inserting an 8:00 event appends it after all of them.
      await handlers.addEvent({ title: 'Early Add', time: '8:00' });
    });

    // Scope to today's column: the static week fixtures also carry a
    // 'Design review' (Wed) and 'Sprint planning' (Wed), so a document-wide
    // indexOf would match those on any weekday today falls after Wednesday.
    const todayColumn = container.querySelector('[data-today]') as HTMLElement | null;
    if (todayColumn === null) throw new Error("expected a today column");
    const earlyIdx = todayColumn.textContent?.indexOf('Early Add') ?? -1;
    const designIdx = todayColumn.textContent?.indexOf('Design review') ?? -1;
    expect(earlyIdx).toBeGreaterThanOrEqual(0);
    expect(designIdx).toBeGreaterThanOrEqual(0);
    expect(earlyIdx).toBeLessThan(designIdx);
  });
});
