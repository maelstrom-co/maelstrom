import { afterEach, describe, expect, mock, test } from 'bun:test';

import type {
  PlanningInput,
  ReplylessCandidate,
  Retryable,
  RetryFeedback,
  ValidateCandidate,
} from '@maelstrom-co/engine';
import { createEngine, withRetry } from '@maelstrom-co/engine';
import type { SpyEntry } from '@maelstrom-co/engine/_testing';
import {
  buildGridResponse,
  makeGridRequest,
  makePlanningInput,
  makeStageContext,
  makeTilingRequest,
  spyLogger,
} from '@maelstrom-co/engine/_testing';
import type { ChartRequest, LayoutMode } from '@maelstrom-co/protocol';
import {
  ChartRequestMessage,
  GridNeedsClarificationSchema,
  isErr,
  isOk,
  TilingNeedsClarificationSchema,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { convertSchemaToJsonSchema } from '@tanstack/ai';

import { dummyAdapter } from './__test-helpers__/fixtures.js';
import type { ClarifyingLlmPlannerInput } from './llm-planner.js';
import { clarifyingLlmPlanner } from './llm-planner.js';
import {
  buildReplylessSystemPrompt,
  buildUserPrompt,
} from './prompt/prompt-builder.js';
import { buildRetryPrompt } from './retry-prompt.js';
import { skipReplyOutputSchemaFor } from './skip-reply-output.js';

const mockChat = mock<(...args: unknown[]) => Promise<unknown>>();
const convertOutputSchema = convertSchemaToJsonSchema;

mock.module('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  convertSchemaToJsonSchema: convertOutputSchema,
}));

afterEach(() => {
  mockChat.mockReset();
});

interface ChatArgs {
  readonly adapter: AnyTextAdapter;
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
  readonly systemPrompts: readonly string[];
  readonly outputSchema: unknown;
}

const modes: readonly LayoutMode[] = ['grid', 'tiling'];

const replylessOutputs = {
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

const overflowingReplylessGridOutput = {
  ...replylessOutputs.grid,
  layout: {
    positions: [
      {
        instanceId: 'calendar-main',
        position: { row: 0, column: 10 },
        size: { width: 6, height: 4 },
      },
    ],
  },
};

const partialExecutionPlan = [
  {
    instanceId: 'calendar-main',
    action: 'showWeek',
    paramsJson: '{"view":"week"}',
  },
];

// Engine-valid partial changes per mode: since clarification partial changes
// are validated like a plan, each must fit the request fixture it targets.
const validClarificationPartials = {
  grid: {
    layout: replylessOutputs.grid.layout,
    executionPlan: [{ instanceId: 'calendar-main', action: 'showWeek' }],
  },
  tiling: {
    layout: {
      tree: ['V', 'ID:calendar-main', null],
      instances: [
        { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
      ],
    },
    executionPlan: [],
  },
} as const;

const REFUSAL_LOG = 'Refused a skipReply outcome the Engine cannot ship';

describe.each(modes)(
  'withRetry(clarifyingLlmPlanner) with the real Engine validator (%s)',
  (mode) => {
    test('a skipReply replyless plan passes validation without a retry', async () => {
      mockChat.mockResolvedValueOnce(replylessOutputs[mode]);
      const run = withRetryUnderSkipReply(mode);

      const result = await run.call();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect<unknown>(result.value).toEqual({
        type: 'plan',
        ...replylessOutputs[mode],
      });
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(run.validations).toHaveLength(1);
      const [report] = run.validations;
      expect(report?.ok).toBe(true);
      if (report === undefined || !isOk(report)) return;
      expect(report.value.diagnostics.retryHint.recommend).toBe(false);
      expect(report.value).not.toHaveProperty('userMessage');
    });

    test('a skipReply clarification with a partial layout and executionPlan returns unchanged without a retry', async () => {
      mockChat.mockResolvedValueOnce({
        ...replylessOutputs[mode],
        executionPlan: partialExecutionPlan,
        clarification: {
          question: 'Which week should it show?',
          options: ['This week', 'Next week'],
        },
      });
      const run = withRetryUnderSkipReply(mode);

      const result = await run.call();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect<unknown>(result.value).toEqual({
        type: 'needs_clarification',
        question: 'Which week should it show?',
        options: ['This week', 'Next week'],
        layout: replylessOutputs[mode].layout,
        executionPlan: partialExecutionPlan,
      });
      expect<unknown>(clarificationSchemaFor(mode).parse(result.value)).toEqual(
        result.value,
      );
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(run.validations).toHaveLength(0);
    });
  },
);

describe('withRetry(clarifyingLlmPlanner) retry under skipReply', () => {
  test('an overflowing replyless plan passes validation with a recommended retry, and the retry keeps the reply-free prompt and schema', async () => {
    mockChat
      .mockResolvedValueOnce(overflowingReplylessGridOutput)
      .mockResolvedValueOnce(replylessOutputs.grid);
    const run = withRetryUnderSkipReply('grid');

    const result = await run.call();

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect<unknown>(result.value).toEqual({
      type: 'plan',
      ...replylessOutputs.grid,
    });
    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(run.validations.map((report) => report.ok)).toEqual([true, true]);
    const retry = run.retries[0];
    if (retry === undefined) throw new Error('second attempt must be a retry');
    expect(run.retries).toHaveLength(1);
    expect<unknown>(retry.previous).toEqual({
      type: 'plan',
      ...overflowingReplylessGridOutput,
    });
    expect(retry.previous).not.toHaveProperty('userMessage');
    expect(retry.diagnostics.retryHint.recommend).toBe(true);
    expect(retry.diagnostics.feedback).toContain('exceeds chart bounds');

    const retried = chatCall(1);
    expect(retried.systemPrompts).toEqual([buildReplylessSystemPrompt('grid')]);
    expect(retried.outputSchema).toEqual(
      convertOutputSchema(skipReplyOutputSchemaFor('grid')),
    );
    expect(retried.messages).toEqual([
      {
        role: 'user',
        content: buildRetryPrompt(
          buildUserPrompt(run.request),
          retry.diagnostics,
        ),
      },
    ]);
    expect(retried.messages[0]?.content).not.toContain('userMessage');
    expect(
      run.logs
        .map((entry) => entry.msg)
        .filter((msg) => msg.startsWith('Retr')),
    ).toEqual(['Retrying after recommended retry', 'Retry succeeded']);
  });
});

describe.each(modes)(
  'createEngine({ planner: clarifyingLlmPlanner }) (%s)',
  (mode) => {
    test('without skipReply a reply-bearing plan ships as a chart_response', async () => {
      mockChat.mockResolvedValueOnce(replyBearingOutputFor(mode));

      const { result } = await handleWithEngine(requestFor(mode));

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.type).toBe('chart_response');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    test('a skipReply replyless plan passes validation and the ship boundary refuses it', async () => {
      mockChat.mockResolvedValueOnce(replylessOutputs[mode]);

      const { result, entries } = await handleWithEngine({
        ...requestFor(mode),
        skipReply: true,
      });

      expectShipBoundaryRefusal(
        result,
        entries,
        'a response without userMessage',
      );
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    test('a skipReply clarification passes validation and the ship boundary refuses it', async () => {
      mockChat.mockResolvedValueOnce({
        rationale: replylessOutputs[mode].rationale,
        ...validClarificationPartials[mode],
        clarification: { question: 'Which calendar?' },
      });

      const { result, entries } = await handleWithEngine({
        ...requestFor(mode),
        skipReply: true,
      });

      expectShipBoundaryRefusal(
        result,
        entries,
        'a needs-clarification result',
      );
      expect(mockChat).toHaveBeenCalledTimes(1);
    });
  },
);

function withRetryUnderSkipReply(mode: LayoutMode) {
  const request: ChartRequest = { ...requestFor(mode), skipReply: true };
  const input = makePlanningInput(request);
  const { logger, entries } = spyLogger();
  const engineValidate = makeStageContext({ origin: input, logger }).validate;
  const validations: ReturnType<ValidateCandidate>[] = [];
  const recordingValidate = ((candidate: ReplylessCandidate) => {
    const report = engineValidate(candidate);
    validations.push(report);
    return report;
  }) as ValidateCandidate;
  const ctx = makeStageContext({
    origin: input,
    logger,
    validate: recordingValidate,
  });
  const retries: RetryFeedback<ReplylessCandidate>[] = [];
  const planner = clarifyingLlmPlanner({ adapter: dummyAdapter });
  const recordingPlanner = (
    attempt: ClarifyingLlmPlannerInput & Retryable<PlanningInput>,
    stageCtx: typeof ctx,
  ) => {
    if (attempt.retry !== undefined) retries.push(attempt.retry);
    return planner(attempt, stageCtx);
  };
  const wrapped = withRetry(recordingPlanner, { max: 1 });
  return {
    request,
    validations,
    retries,
    logs: entries,
    call: () => wrapped(input, ctx),
  };
}

async function handleWithEngine(request: ChartRequest) {
  const { logger, entries } = spyLogger();
  const input = makePlanningInput(request);
  const engine = createEngine({
    planner: clarifyingLlmPlanner({ adapter: dummyAdapter }),
    retry: { max: 1 },
    logger,
  });
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: input.sessionId,
      id: input.messageId,
      request,
    }),
  );
  return { result, entries };
}

function expectShipBoundaryRefusal(
  result: Awaited<ReturnType<typeof handleWithEngine>>['result'],
  entries: readonly SpyEntry[],
  outcome: string,
): void {
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) return;
  expect(result.error).toMatchObject({
    _tag: 'ValidationError',
    field: 'skipReply',
  });
  expect(entries.filter((entry) => entry.level === 'error')).toEqual([]);
  expect(entries.filter((entry) => entry.msg === REFUSAL_LOG)).toEqual([
    {
      level: 'warn',
      msg: REFUSAL_LOG,
      ctx: { messageId: makePlanningInput().messageId, outcome },
    },
  ]);
}

function requestFor(mode: LayoutMode): ChartRequest {
  return mode === 'grid' ? makeGridRequest() : makeTilingRequest();
}

function replyBearingOutputFor(mode: LayoutMode) {
  return mode === 'grid'
    ? buildGridResponse()
    : { userMessage: 'Split the screen.', ...replylessOutputs.tiling };
}

function clarificationSchemaFor(mode: LayoutMode) {
  return mode === 'grid'
    ? GridNeedsClarificationSchema
    : TilingNeedsClarificationSchema;
}

function chatCall(index: number): ChatArgs {
  const args = mockChat.mock.calls[index]?.[0] as ChatArgs | undefined;
  if (args === undefined) throw new Error(`no chat call at index ${index}`);
  return args;
}
