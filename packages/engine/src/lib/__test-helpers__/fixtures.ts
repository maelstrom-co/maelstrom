import type { ChartRequest } from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';

import type { Logger } from '../logger.js';

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// AnyTextAdapter's phantom `~types` field has no runtime shape, so
// `satisfies` can't reproduce it — the double-cast is the only option.
export const dummyAdapter = {
  kind: 'text',
  name: 'dummy',
  model: 'dummy-model',
  chatStream: () => {
    throw new Error('dummyAdapter.chatStream not callable in tests');
  },
  structuredOutput: () => {
    throw new Error('dummyAdapter.structuredOutput not callable in tests');
  },
} as unknown as AnyTextAdapter;

export function makeGridRequest(
  overrides?: Partial<ChartRequest>,
): ChartRequest {
  return {
    type: 'chart_request',
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'Show me my calendar' }],
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'grid',
    },
    instances: [
      {
        instanceId: InstanceId('calendar-main'),
        vesselId: 'calendar',
        variant: 'month',
      },
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
          instanceId: InstanceId('calendar-main'),
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
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'Add a task list' }],
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'tiling',
    },
    instances: [
      {
        instanceId: InstanceId('calendar-main'),
        vesselId: 'calendar',
        variant: 'month',
      },
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
      tree: [InstanceId('calendar-main')],
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'calendar',
          variant: 'month',
        },
      ],
    },
    ...overrides,
  };
}
