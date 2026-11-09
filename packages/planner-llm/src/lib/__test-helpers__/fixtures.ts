import type { EngineDiagnostics } from '@maelstrom-co/engine';
import {
  buildGridResponse,
  makeGridRequest,
  makeTilingRequest,
} from '@maelstrom-co/engine/_testing';
import type { ChartRequest, LayoutMode } from '@maelstrom-co/protocol';
import type { AnyTextAdapter, ChatMiddleware } from '@tanstack/ai';

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
 * Diagnostics shaped like the Engine's for a response whose only layout
 * entry overflowed the chart: retry recommended, one drop, no actions.
 */
export const overflowDiagnostics: EngineDiagnostics = {
  retryHint: { severity: 'unrecoverable', recommend: true },
  counts: { skippedActions: 0, droppedLayoutEntries: 1, warnings: 0 },
  feedback: [
    'Layout drops:',
    '- instance "calendar-main" at (0,10) size 6x4 exceeds chart bounds (12x8)',
  ].join('\n'),
};

export interface ChatArgs {
  readonly adapter: AnyTextAdapter;
  readonly threadId: string;
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
  readonly systemPrompts: readonly string[];
  readonly outputSchema: unknown;
  readonly middleware: readonly ChatMiddleware[];
  readonly abortController: AbortController;
}

export const replylessOutputs = {
  grid: {
    rationale: 'Top left has room.',
    executionPlan: [],
    layout: {
      positions: [
        {
          instanceId: 'calendar-main',
          position: { row: 0, column: 0 },
          size: { width: 6, height: 4 },
        },
      ],
    },
  },
  tiling: {
    rationale: 'Two panes side by side.',
    executionPlan: [],
    layout: {
      tree: ['H', 'ID:calendar-main', 'ID:notes-main'],
      instances: [
        {
          instanceId: 'calendar-main',
          vesselId: 'calendar',
          variant: 'month',
        },
        { instanceId: 'notes-main', vesselId: 'notes', variant: 'list' },
      ],
    },
  },
} as const;

export const partialExecutionPlan = [
  {
    instanceId: 'calendar-main',
    action: 'showWeek',
    paramsJson: '{"view":"week"}',
  },
];

export function requestFor(mode: LayoutMode): ChartRequest {
  return mode === 'grid' ? makeGridRequest() : makeTilingRequest();
}

export function replyBearingOutputFor(mode: LayoutMode) {
  return mode === 'grid'
    ? buildGridResponse()
    : { userMessage: 'Split the screen.', ...replylessOutputs.tiling };
}

export function chatCall(
  mockChat: { readonly mock: { readonly calls: readonly unknown[][] } },
  index: number,
): ChatArgs {
  const args = mockChat.mock.calls[index]?.[0] as ChatArgs | undefined;
  if (args === undefined) throw new Error(`no chat call at index ${index}`);
  return args;
}
