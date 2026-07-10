// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isErr, isOk, type Result } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
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
});
