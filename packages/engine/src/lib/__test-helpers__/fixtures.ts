import type {
  ActionName,
  ChartRequest,
  VariantName,
  Vessel,
  VesselId,
} from '@maelstrom-co/protocol';
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

/**
 * Negative-path schema-test helper. Wraps the `as unknown as T` double-cast
 * with a named call so test intent is explicit and a grep for
 * `as unknown as` in production code stays clean.
 */
export const invalid = <T>(v: unknown): T => v as T;

interface ChatCallShape {
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant' | 'system';
    readonly content: string;
  }>;
}

/**
 * Pulls the most recent `role: 'user'` message content out of the mocked
 * `chat()` call at index `callIndex`. Throws on shape mismatch so a future
 * adapter signature drift fails the test type-check instead of slipping
 * through string-shape assertions.
 */
export function getLastUserMessage(
  mockChat: { readonly mock: { readonly calls: ReadonlyArray<unknown[]> } },
  callIndex: number,
): string {
  const callArgs = mockChat.mock.calls[callIndex]?.[0] as
    | ChatCallShape
    | undefined;
  if (!callArgs?.messages) {
    throw new Error(
      `getLastUserMessage: call ${callIndex} has no messages array`,
    );
  }
  const userMessages = callArgs.messages.filter((m) => m.role === 'user');
  const last = userMessages[userMessages.length - 1];
  if (!last) {
    throw new Error(
      `getLastUserMessage: call ${callIndex} has no user-role message`,
    );
  }
  return last.content;
}

/**
 * Author-shape overrides for `ChartRequest` test fixtures. Accepts raw
 * strings for branded slots — brands erase at runtime, so the cast at the
 * boundary is sound for trusted fixture inputs.
 */
export type AuthorVesselAction = {
  readonly name: string;
  readonly description: string;
  readonly parameters?: ReadonlyArray<unknown>;
  readonly transitionsTo?: string;
};
export type AuthorVesselVariant = {
  readonly description?: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly minSize: { readonly width: number; readonly height: number };
  readonly actions: ReadonlyArray<AuthorVesselAction>;
};
export type AuthorVessel = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defaultVariant: string;
  readonly variants: Readonly<Record<string, AuthorVesselVariant>>;
};

/**
 * Constructs a typed `Vessel` from a plain author shape. `Vessel`'s ids,
 * variant keys, and action name/transitionsTo are branded by the schema's
 * `.transform()` step, but brands erase at runtime — so a single cast at
 * this factory boundary is sound for trusted fixture inputs and keeps
 * test fixtures free of per-call `as unknown as Vessel` escape hatches.
 */
export function makeVessel(author: AuthorVessel): Vessel {
  return author as unknown as Vessel;
}
type AuthorTilingNode = 'H' | 'V' | string | null;
type ChartRequestAuthorOverrides = Partial<{
  readonly type: 'chart_request';
  readonly context: ChartRequest['context'];
  readonly instances: ReadonlyArray<{
    readonly instanceId: string;
    readonly vesselId: string;
    readonly variant: string;
  }>;
  readonly vessels: ReadonlyArray<AuthorVessel>;
  readonly layout:
    | {
        readonly type: 'grid';
        readonly positions: ReadonlyArray<{
          readonly instanceId: string;
          readonly position: { readonly row: number; readonly column: number };
          readonly size: { readonly width: number; readonly height: number };
        }>;
      }
    | {
        readonly type: 'tiling';
        readonly tree: ReadonlyArray<AuthorTilingNode>;
        readonly instances: ReadonlyArray<{
          readonly instanceId: string;
          readonly vesselId: string;
          readonly variant: string;
        }>;
      };
}>;

export function makeGridRequest(
  overrides?: ChartRequestAuthorOverrides,
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
        vesselId: 'calendar' as VesselId,
        variant: 'month' as VariantName,
      },
    ],
    vessels: [
      {
        id: 'calendar' as VesselId,
        name: 'Calendar',
        description: 'Displays events in various views',
        defaultVariant: 'month' as VariantName,
        variants: {
          ['month' as VariantName]: {
            description: 'Monthly overview',
            props: {},
            minSize: { width: 4, height: 4 },
            actions: [
              {
                name: 'showWeek' as ActionName,
                description: 'Switch to week view',
                transitionsTo: 'week' as VariantName,
              },
            ],
          },
          ['week' as VariantName]: {
            description: 'Weekly detail view',
            props: {},
            minSize: { width: 6, height: 4 },
            actions: [
              {
                name: 'showMonth' as ActionName,
                description: 'Switch to month view',
                transitionsTo: 'month' as VariantName,
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
  } as ChartRequest;
}

export function makeTilingRequest(
  overrides?: ChartRequestAuthorOverrides,
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
        vesselId: 'calendar' as VesselId,
        variant: 'month' as VariantName,
      },
    ],
    vessels: [
      {
        id: 'calendar' as VesselId,
        name: 'Calendar',
        description: 'Displays events',
        defaultVariant: 'month' as VariantName,
        variants: {
          ['month' as VariantName]: {
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
          vesselId: 'calendar' as VesselId,
          variant: 'month' as VariantName,
        },
      ],
    },
    ...overrides,
  } as ChartRequest;
}
