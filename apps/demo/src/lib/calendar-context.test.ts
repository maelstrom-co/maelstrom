import { WebSocketConnector } from '@maelstrom-co/client';
import {
  type ChartRequestMessage,
  type MaelstromResponse,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserCalendarContext,
  withBrowserCalendarContext,
} from './calendar-context';
import { createDemoConnector } from './connector';

function message(
  reasons: ChartRequestMessage['request']['context']['updateReasons'],
) {
  return {
    id: MessageId('request'),
    sessionId: SessionId('session'),
    timestamp: 0,
    request: {
      context: { updateReasons: reasons },
      instances: [],
      vessels: [],
      layout: {},
    },
  } as unknown as ChartRequestMessage;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('browser calendar context', () => {
  it('uses the user calendar day rather than the UTC day around midnight', () => {
    const now = new Date('2026-09-27T01:00:00Z');
    expect(browserCalendarContext(now, 'America/Montevideo')).toEqual({
      localDate: '2026-09-26',
      timeZone: 'America/Montevideo',
      observedAt: '2026-09-27T01:00:00.000Z',
    });
    expect(browserCalendarContext(now, 'Asia/Tokyo').localDate).toBe(
      '2026-09-27',
    );
  });

  it('keeps calendar dates correct across leap days and daylight-saving transitions', () => {
    expect(
      browserCalendarContext(
        new Date('2028-03-01T01:00:00Z'),
        'America/Montevideo',
      ).localDate,
    ).toBe('2028-02-29');
    expect(
      browserCalendarContext(
        new Date('2026-03-08T06:59:00Z'),
        'America/New_York',
      ).localDate,
    ).toBe('2026-03-08');
    expect(
      browserCalendarContext(
        new Date('2026-03-08T07:01:00Z'),
        'America/New_York',
      ).localDate,
    ).toBe('2026-03-08');
  });

  it('preserves the compound intent and request identity without mutating caller state', () => {
    const intent =
      'Replace calendar with journal; create an entry titled today’s date and write "Test note".';
    const original = message([{ type: 'user_intent', intent }]);
    const calendar = browserCalendarContext(
      new Date('2026-09-27T01:00:00Z'),
      'America/Montevideo',
    );
    const enriched = withBrowserCalendarContext(original, calendar);
    expect(original.request.context.updateReasons).toEqual([
      { type: 'user_intent', intent },
    ]);
    expect(enriched.id).toBe(original.id);
    expect(enriched.sessionId).toBe(original.sessionId);
    expect(enriched.request.instances).toBe(original.request.instances);
    expect(enriched.request.context.updateReasons).toEqual([
      {
        type: 'user_intent',
        intent: `${intent}\n\nBrowser calendar context for this request: ${JSON.stringify(calendar)}`,
      },
    ]);
  });

  it('does not turn an empty or resize-only request into a content mutation', () => {
    const resize = {
      type: 'chart_resize' as const,
      previous: { columns: 10, rows: 10 },
      current: { columns: 12, rows: 10 },
    };
    for (const original of [
      message([]),
      message([resize]),
      message([{ type: 'user_intent', intent: '  ' }]),
    ]) {
      expect(withBrowserCalendarContext(original)).toBe(original);
    }
  });

  it('refreshes the actual connector payload for each request without extra Engine calls', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const response = {
      userMessage: 'Done',
      executionPlan: [],
    } as unknown as MaelstromResponse;
    const process = vi
      .spyOn(WebSocketConnector.prototype, 'process')
      .mockResolvedValue(response);
    const connector = createDemoConnector();
    const original = message([
      { type: 'user_intent', intent: 'Create a journal titled today’s date' },
    ]);
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
    const firstContext = browserCalendarContext();
    expect(await connector.process(original)).toBe(response);
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    const secondContext = browserCalendarContext();
    const second = { ...original, id: MessageId('request-2') };
    await connector.process(second);
    expect(process).toHaveBeenCalledTimes(2);
    expect(process).toHaveBeenNthCalledWith(
      1,
      withBrowserCalendarContext(original, firstContext),
    );
    expect(process).toHaveBeenNthCalledWith(
      2,
      withBrowserCalendarContext(second, secondContext),
    );
    expect(firstContext.localDate).not.toBe(secondContext.localDate);
  });
});
