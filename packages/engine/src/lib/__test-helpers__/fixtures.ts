import type { ChartRequest } from '@maelstrom-co/protocol-old';
import { MessageId, SessionId } from '@maelstrom-co/protocol';

import type { Logger } from '../logger.js';

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function makeGridRequest(
  overrides?: Partial<ChartRequest>,
): ChartRequest {
  return {
    type: 'chart_request',
    id: MessageId('req-1'),
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'Show me my calendar' }],
      chartDimensions: { columns: 12, rows: 8 },
      timestamp: Date.now(),
      sessionId: SessionId('session-1'),
      layoutMode: 'grid',
    },
    instances: [
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
    ],
    vessels: [
      {
        id: 'calendar',
        name: 'Calendar',
        description: 'Displays events in various views',
        defaultVariant: 'month',
        variants: {
          month: {
            description: 'Monthly overview',
            props: {},
            minSize: { width: 4, height: 4 },
            actions: [
              {
                name: 'showWeek',
                description: 'Switch to week view',
                transitionsTo: 'week',
              },
            ],
          },
          week: {
            description: 'Weekly detail view',
            props: {},
            minSize: { width: 6, height: 4 },
            actions: [
              {
                name: 'showMonth',
                description: 'Switch to month view',
                transitionsTo: 'month',
              },
            ],
          },
        },
      },
    ],
    layout: {
      type: 'grid',
      positions: [
        {
          instanceId: 'calendar-main',
          position: { row: 0, column: 0 },
          size: { width: 6, height: 4 },
        },
      ],
    },
    ...overrides,
  };
}

export function makeTilingRequest(
  overrides?: Partial<ChartRequest>,
): ChartRequest {
  return {
    type: 'chart_request',
    id: MessageId('req-2'),
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'Add a task list' }],
      chartDimensions: { columns: 12, rows: 8 },
      timestamp: Date.now(),
      sessionId: SessionId('session-2'),
      layoutMode: 'tiling',
    },
    instances: [
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
    ],
    vessels: [
      {
        id: 'calendar',
        name: 'Calendar',
        description: 'Displays events',
        defaultVariant: 'month',
        variants: {
          month: {
            props: {},
            minSize: { width: 4, height: 4 },
            actions: [],
          },
        },
      },
    ],
    layout: {
      type: 'tiling',
      tree: ['calendar-main'],
      instances: [
        {
          instanceId: 'calendar-main',
          vesselId: 'calendar',
          variant: 'month',
        },
      ],
    },
    ...overrides,
  };
}
