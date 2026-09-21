import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ChartRequest } from '@maelstrom-co/protocol';
import {
  ChartRequestMessage,
  GridResponseSchema,
  isErr,
  isOk,
  MessageId,
  SessionId,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';

import {
  buildGridResponse,
  dummyAdapter,
  makeGridRequest,
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import {
  makePlanningInput,
  makeStageContext,
  spyLogger,
} from '../__test-helpers__/stage-context.js';
import { createEngine } from '../engine.js';
import type { LLMContextMessage } from '../history/history-manager.js';
import type { PromptOptions } from '../prompt/prompt-builder.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
} from '../prompt/prompt-builder.js';
import type { LlmPlannerOptions } from './llm-planner.js';
import { llmPlanner } from './llm-planner.js';
import { buildRetryPrompt } from './retry-prompt.js';
import type { PlanningInput } from './stage.js';

const mockChat = mock<(...args: unknown[]) => Promise<unknown>>();

mock.module('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}));

afterEach(() => {
  mockChat.mockReset();
});

interface ChatArgs {
  readonly adapter: unknown;
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
  readonly systemPrompts: readonly string[];
  readonly outputSchema: unknown;
  readonly stream: boolean;
  readonly abortController: AbortController;
  readonly modelOptions?: Record<string, unknown>;
}

function chatCall(index: number): ChatArgs {
  const args = mockChat.mock.calls[index]?.[0] as ChatArgs | undefined;
  if (args === undefined) throw new Error(`no chat call at index ${index}`);
  return args;
}

function comparableChatCalls(): Array<Omit<ChatArgs, 'abortController'>> {
  return mockChat.mock.calls.map((call) => {
    const { abortController: _ignored, ...rest } = call[0] as ChatArgs;
    return rest;
  });
}

const overflowingResponse = buildGridResponse({
  layout: {
    positions: [
      {
        instanceId: 'calendar-main',
        position: { row: 0, column: 10 },
        size: { width: 6, height: 4 },
      },
    ],
  },
});

describe('llmPlanner', () => {
  describe('as the Engine planner', () => {
    test.each([
      ['grid', makeGridRequest()],
      ['tiling', makeTilingRequest()],
    ] as Array<
      [string, ChartRequest]
    >)('%s: createEngine sends one chat() call built from the request', async (_, request) => {
      const prompt: PromptOptions = {
        vars: { assistantName: 'Aria' },
        user: { chartState: { append: 'Keep it tidy.' } },
      };
      const modelOptions = { max_output_tokens: 1234 };
      const mode = request.context.layoutMode;
      mockChat.mockResolvedValue(
        mode === 'grid'
          ? buildGridResponse()
          : {
              userMessage: 'ok',
              rationale: 'r',
              executionPlan: [],
              layout: request.layout,
            },
      );

      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter, prompt, modelOptions }),
        logger: silentLogger,
      });
      const result = await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request,
        }),
      );

      expect(isOk(result)).toBe(true);
      expect(comparableChatCalls()).toEqual([
        {
          adapter: dummyAdapter,
          messages: [
            { role: 'user', content: buildUserPrompt(request, prompt) },
          ],
          systemPrompts: [buildSystemPrompt(mode, prompt)],
          outputSchema:
            mode === 'grid' ? GridResponseSchema : TilingResponseSchema,
          stream: false,
          modelOptions,
        },
      ]);
    });

    test('an Engine retry resends the system prompt with the retry prompt built from the first diagnostics', async () => {
      const request = makeGridRequest();
      mockChat
        .mockResolvedValueOnce(overflowingResponse)
        .mockResolvedValueOnce(buildGridResponse());
      const input = makePlanningInput(request);
      const expected = makeStageContext({ origin: input }).validate(
        overflowingResponse,
      );
      if (!isOk(expected)) throw new Error('fixture must validate');

      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter }),
        logger: silentLogger,
      });
      const result = await engine.handle(
        ChartRequestMessage({
          sessionId: input.sessionId,
          id: input.messageId,
          request,
        }),
      );

      expect(isOk(result)).toBe(true);
      expect(mockChat).toHaveBeenCalledTimes(2);
      expect(chatCall(1).systemPrompts).toEqual(chatCall(0).systemPrompts);
      expect(chatCall(1).messages).toEqual([
        {
          role: 'user',
          content: buildRetryPrompt(
            buildUserPrompt(request),
            expected.value.diagnostics,
          ),
        },
      ]);
    });
  });

  test('sends the system prompt, history, then the user prompt', async () => {
    mockChat.mockResolvedValue(buildGridResponse());
    const history: LLMContextMessage[] = [
      { role: 'user', content: 'earlier intent' },
      { role: 'assistant', content: 'earlier reply' },
    ];
    const request = makeGridRequest();
    const input: PlanningInput = { ...makePlanningInput(request), history };

    await llmPlanner({ adapter: dummyAdapter })(
      input,
      makeStageContext({ origin: input }),
    );

    const call = chatCall(0);
    expect(call.adapter).toBe(dummyAdapter);
    expect(call.systemPrompts).toEqual([buildSystemPrompt('grid')]);
    expect(call.messages).toEqual([
      ...history,
      { role: 'user', content: buildUserPrompt(request) },
    ]);
    expect(call.stream).toBe(false);
    expect('modelOptions' in call).toBe(false);
  });

  test('builds the retry prompt from the original prompt and the latest diagnostics only', async () => {
    const request = makeGridRequest();
    mockChat.mockResolvedValue(buildGridResponse());
    let customizerCalls = 0;
    const planner = llmPlanner({
      adapter: dummyAdapter,
      prompt: {
        user: {
          vessels: (defaults) => {
            customizerCalls += 1;
            return defaults;
          },
        },
      },
    });
    const input = makePlanningInput(request);
    const ctx = makeStageContext({ origin: input });
    const validated = ctx.validate(overflowingResponse);
    if (!isOk(validated)) throw new Error('fixture must validate');
    const { diagnostics } = validated.value;

    await planner(input, ctx);
    await planner(
      {
        ...input,
        retry: { attempt: 1, previous: overflowingResponse, diagnostics },
      },
      ctx,
    );

    const original = buildUserPrompt(request);
    expect(chatCall(0).messages.at(-1)?.content).toBe(original);
    expect(chatCall(1).messages.at(-1)?.content).toBe(
      buildRetryPrompt(original, diagnostics),
    );
    expect(customizerCalls).toBe(1);
  });

  test('a narrowed Vessel catalog renders enum literals from that catalog', async () => {
    mockChat.mockResolvedValue(buildGridResponse());
    const base = makeGridRequest();
    const request = withShowWeekParameter(base, ['day', 'week', 'month']);
    const origin = makePlanningInput(request);
    const narrowed: ChartRequest = withShowWeekParameter(request, ['week']);

    const result = await llmPlanner({ adapter: dummyAdapter })(
      { ...origin, request: narrowed },
      makeStageContext({ origin }),
    );

    expect(isOk(result)).toBe(true);
    const prompt = chatCall(0).messages.at(-1)?.content ?? '';
    expect(prompt).toContain('view: "week"');
    expect(prompt).not.toContain('"month"');
  });

  describe('hints', () => {
    test('are appended to the user prompt as their own section', async () => {
      mockChat.mockResolvedValue(buildGridResponse());
      const request = makeGridRequest();
      const input = {
        ...makePlanningInput(request),
        hints: ['Prefer the calendar', 'Keep one instance'],
      };

      await llmPlanner({ adapter: dummyAdapter })(
        input,
        makeStageContext({ origin: input }),
      );

      expect(chatCall(0).messages.at(-1)?.content).toBe(
        `${buildUserPrompt(request)}\n\n## Planner Hints\n\n- Prefer the calendar\n- Keep one instance`,
      );
    });

    test('an empty list leaves the prompt unchanged', async () => {
      mockChat.mockResolvedValue(buildGridResponse());
      const request = makeGridRequest();
      const input = { ...makePlanningInput(request), hints: [] };

      await llmPlanner({ adapter: dummyAdapter })(
        input,
        makeStageContext({ origin: input }),
      );

      expect(chatCall(0).messages.at(-1)?.content).toBe(
        buildUserPrompt(request),
      );
    });

    test('carry into the retry prompt as part of the original request', async () => {
      mockChat.mockResolvedValue(buildGridResponse());
      const request = makeGridRequest();
      const hints = ['Prefer the calendar'];
      const input = { ...makePlanningInput(request), hints };
      const ctx = makeStageContext({ origin: input });
      const validated = ctx.validate(overflowingResponse);
      if (!isOk(validated)) throw new Error('fixture must validate');
      const { diagnostics } = validated.value;

      await llmPlanner({ adapter: dummyAdapter })(
        {
          ...input,
          retry: { attempt: 1, previous: overflowingResponse, diagnostics },
        },
        ctx,
      );

      expect(chatCall(0).messages.at(-1)?.content).toBe(
        buildRetryPrompt(
          `${buildUserPrompt(request)}\n\n## Planner Hints\n\n- Prefer the calendar`,
          diagnostics,
        ),
      );
    });
  });

  describe('failures', () => {
    test('a throwing user-section customizer is Err(ValidationError) on field "prompt", logged, no LLM call', async () => {
      const { logger, entries } = spyLogger();
      const planner = llmPlanner({
        adapter: dummyAdapter,
        prompt: {
          user: {
            vessels: () => {
              throw new Error('customizer exploded');
            },
          },
        },
      });

      const result = await planner(
        makePlanningInput(),
        makeStageContext({ logger }),
      );

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error).toMatchObject({
        _tag: 'ValidationError',
        field: 'prompt',
        message: expect.stringContaining('customizer exploded'),
      });
      expect(mockChat).not.toHaveBeenCalled();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        level: 'error',
        msg: 'Failed to build user prompt',
        ctx: { messageId: makePlanningInput().messageId },
      });
      expect(entries[0]?.error).toBe(
        (result.error as { cause?: unknown }).cause,
      );
    });

    test('a provider failure is Err(ProviderError), logged as "LLM call failed"', async () => {
      const { logger, entries } = spyLogger();
      mockChat.mockRejectedValue(new Error('rate limited'));

      const result = await llmPlanner({ adapter: dummyAdapter })(
        makePlanningInput(),
        makeStageContext({ logger }),
      );

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('ProviderError');
      expect(entries.map((e) => [e.level, e.msg])).toEqual([
        ['error', 'LLM call failed'],
      ]);
    });

    test('a pre-aborted signal is Err(CancellationError) without calling the LLM', async () => {
      const { logger, entries } = spyLogger();
      const controller = new AbortController();
      controller.abort('gone');

      const result = await llmPlanner({ adapter: dummyAdapter })(
        makePlanningInput(),
        makeStageContext({ logger, signal: controller.signal }),
      );

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('CancellationError');
      expect(mockChat).not.toHaveBeenCalled();
      expect(entries.map((e) => [e.level, e.msg])).toEqual([
        ['info', 'Request cancelled'],
      ]);
    });

    test('forwards the context signal to the LLM call', async () => {
      const controller = new AbortController();
      mockChat.mockImplementation(async () => {
        controller.abort('late');
        throw new Error('socket closed');
      });

      const result = await llmPlanner({ adapter: dummyAdapter })(
        makePlanningInput(),
        makeStageContext({ signal: controller.signal }),
      );

      expect(isErr(result) && result.error._tag).toBe('CancellationError');
    });
  });

  describe('construction', () => {
    test.each([
      {
        name: 'missing adapter',
        options: {},
        pattern: /^Invalid LlmPlannerOptions: adapter/,
      },
      {
        name: 'adapter missing required methods',
        options: { adapter: { kind: 'text', name: 'x', model: 'm' } },
        pattern: /adapter\.(chatStream|structuredOutput)/,
      },
      {
        name: 'unrecognized key',
        options: { adapter: dummyAdapter, prompts: {} },
        pattern: /unrecognized|prompts/i,
      },
      {
        name: 'invalid nested prompt field',
        options: { adapter: dummyAdapter, prompt: { system: { rules: 42 } } },
        pattern: /prompt\.system\.rules/,
      },
      {
        name: 'non-object modelOptions',
        options: { adapter: dummyAdapter, modelOptions: 'fast' },
        pattern: /modelOptions/,
      },
    ])('$name throws', ({ options, pattern }) => {
      expect(() => llmPlanner(options as unknown as LlmPlannerOptions)).toThrow(
        pattern,
      );
    });

    test('a misconfigured system customizer throws at construction', () => {
      expect(() =>
        llmPlanner({
          adapter: dummyAdapter,
          prompt: {
            system: {
              rules: () => {
                throw new Error('nope');
              },
            },
          },
        }),
      ).toThrow(/^Invalid LlmPlannerOptions: prompt\.system: .*nope/);
    });
  });
});

function withShowWeekParameter(
  request: ChartRequest,
  values: readonly string[],
): ChartRequest {
  const [calendar, ...rest] = request.vessels;
  if (calendar === undefined) throw new Error('fixture needs a Vessel');
  const variant = calendar.variants[calendar.defaultVariant];
  const [showWeek, ...actions] = variant?.actions ?? [];
  if (variant === undefined || showWeek === undefined) {
    throw new Error('fixture needs an Action');
  }
  return {
    ...request,
    vessels: [
      {
        ...calendar,
        variants: {
          ...calendar.variants,
          [calendar.defaultVariant]: {
            ...variant,
            actions: [
              {
                ...showWeek,
                parameters: [
                  {
                    name: 'view',
                    type: 'string',
                    description: 'Which view to show',
                    enum: [...values],
                  },
                ],
              },
              ...actions,
            ],
          },
        },
      },
      ...rest,
    ],
  };
}
