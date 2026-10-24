import { afterEach, describe, expect, mock, test } from 'bun:test';
import type {
  Instrument,
  InstrumentAttributes,
  LLMContextMessage,
  PlanningInput,
  Retryable,
  RetryFeedback,
} from '@maelstrom-co/engine';
import { createEngine } from '@maelstrom-co/engine';
import {
  brandTilingResponse,
  buildGridResponse,
  makeGridRequest,
  makePlanningInput,
  makeStageContext,
  makeTilingRequest,
  silentLogger,
  spyLogger,
} from '@maelstrom-co/engine/_testing';
import type { ChartRequest } from '@maelstrom-co/protocol';
import {
  ActionName,
  ChartRequestMessage,
  GridResponseSchema,
  InstanceId,
  isErr,
  isOk,
  MessageId,
  SessionId,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';
import type {
  ChatMiddleware,
  RunErrorEvent,
  RunFinishedEvent,
  TokenUsage,
} from '@tanstack/ai';
import { convertSchemaToJsonSchema } from '@tanstack/ai';

import {
  dummyAdapter,
  overflowDiagnostics,
} from './__test-helpers__/fixtures.js';
import type { LlmPlannerOptions } from './llm-planner.js';
import { llmPlanner } from './llm-planner.js';
import type { PromptOptions } from './prompt/prompt-builder.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt/prompt-builder.js';
import { buildRetryPrompt } from './retry-prompt.js';

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
  readonly adapter: unknown;
  readonly threadId: string;
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
  readonly systemPrompts: readonly string[];
  readonly outputSchema: unknown;
  readonly stream: boolean;
  readonly debug: boolean;
  readonly abortController: AbortController;
  readonly middleware: readonly ChatMiddleware[];
  readonly modelOptions?: Record<string, unknown>;
}

async function reportUsage(
  middleware: ChatMiddleware | undefined,
  usage: TokenUsage,
) {
  await middleware?.onConfig?.({} as never, {} as never);
  await middleware?.onChunk?.({} as never, {
    type: 'RUN_FINISHED' as RunFinishedEvent['type'],
    runId: 'r',
    threadId: 't',
    timestamp: 1,
    usage,
  });
  await middleware?.onUsage?.({} as never, usage);
}

function chatCall(index: number): ChatArgs {
  const args = mockChat.mock.calls[index]?.[0] as ChatArgs | undefined;
  if (args === undefined) throw new Error(`no chat call at index ${index}`);
  return args;
}

function comparableChatCalls(): Array<
  Omit<ChatArgs, 'abortController' | 'middleware'>
> {
  return mockChat.mock.calls.map((call) => {
    const {
      abortController: _ignored,
      middleware: _middleware,
      ...rest
    } = call[0] as ChatArgs;
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

test('keeps model calls in their session without sharing threads across sessions', async () => {
  mockChat.mockResolvedValue(buildGridResponse());
  const planner = llmPlanner({ adapter: dummyAdapter });
  for (const [index, session] of [
    'session-1',
    'session-1',
    'session-2',
  ].entries()) {
    const input = {
      ...makePlanningInput(),
      messageId: MessageId(`req-${index}`),
      sessionId: SessionId(session),
    };
    expect((await planner(input, makeStageContext({ origin: input }))).ok).toBe(
      true,
    );
    expect(chatCall(index).threadId).toBe(session);
  }
});

describe('createEngine — system prompt memoization', () => {
  test('derives system prompts once per createEngine and routes by layout mode', async () => {
    let customizerCalls = 0;
    const engine = createEngine({
      planner: llmPlanner({
        adapter: dummyAdapter,
        prompt: {
          system: {
            rules: (defaults) => {
              customizerCalls++;
              return `${defaults}\n\nSENTINEL_RULES`;
            },
          },
        },
      }),
      logger: silentLogger,
    });

    // One customizer call per mode at planner construction (grid + tiling).
    expect(customizerCalls).toBe(2);

    const tilingLLMResponse = brandTilingResponse({
      userMessage: 'Tiling ready',
      rationale: 'User asked for tiling',
      executionPlan: [],
      layout: {
        tree: ['calendar-main'],
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
        ],
      },
    });
    mockChat.mockResolvedValueOnce(buildGridResponse());
    mockChat.mockResolvedValueOnce(tilingLLMResponse);
    mockChat.mockResolvedValueOnce(buildGridResponse());

    await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('session-1'),
        id: MessageId('req-1'),
        request: makeGridRequest(),
      }),
    );
    await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('session-1'),
        id: MessageId('req-2'),
        request: makeTilingRequest(),
      }),
    );
    await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('session-1'),
        id: MessageId('req-3'),
        request: makeGridRequest(),
      }),
    );

    // Per-request path must not re-derive — customizer count is unchanged.
    expect(customizerCalls).toBe(2);

    const gridFirst = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    const tilingCall = mockChat.mock.calls[1]?.[0] as Record<string, unknown>;
    const gridSecond = mockChat.mock.calls[2]?.[0] as Record<string, unknown>;

    // Customized output (sentinel) reaches the LLM for both modes — proves
    // promptOptions wasn't dropped on the per-request path.
    for (const call of [gridFirst, tilingCall, gridSecond]) {
      const systemPrompts = call.systemPrompts as string[];
      expect(systemPrompts[0]).toContain('SENTINEL_RULES');
    }

    // Mode-specific content distinguishes the precomputed entries — proves
    // systemPrompts[mode] is keyed off the request's layoutMode.
    expect((gridFirst.systemPrompts as string[])[0]).toContain(
      'GRID LAYOUT SYSTEM',
    );
    expect((tilingCall.systemPrompts as string[])[0]).toContain(
      'TILING LAYOUT SYSTEM',
    );
    expect((gridSecond.systemPrompts as string[])[0]).toContain(
      'GRID LAYOUT SYSTEM',
    );
  });

  test('user-customizer errors still surface as Result err per request', async () => {
    const engine = createEngine({
      planner: llmPlanner({
        adapter: dummyAdapter,
        prompt: {
          user: {
            vessels: () => {
              throw new Error('user boom');
            },
          },
        },
      }),
      logger: silentLogger,
    });

    const result = await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('session-1'),
        id: MessageId('req-1'),
        request: makeGridRequest(),
      }),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ValidationError');
    if (result.error._tag !== 'ValidationError') return;
    expect(result.error.field).toBe('prompt');
    expect(result.error.message).toMatch(/customizer for "vessels" threw/);
    // The user-thrown error must remain reachable across the engine boundary
    // so debuggers can recover the customizer's original failure. Walk the
    // `.cause` chain rather than asserting a fixed depth — that decouples
    // this test from prompt-builder's wrapping shape.
    expect(findCauseMessage(result.error.cause, 'user boom')).toBe(true);
    // chat() must not be called when prompt construction fails.
    expect(mockChat).not.toHaveBeenCalled();
  });
});

const findCauseMessage = (cause: unknown, target: string): boolean => {
  let current: unknown = cause;
  while (current instanceof Error) {
    if (current.message === target) return true;
    current = current.cause;
  }
  return false;
};

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
          threadId: 'session-1',
          messages: [
            { role: 'user', content: buildUserPrompt(request, prompt) },
          ],
          systemPrompts: [buildSystemPrompt(mode, prompt)],
          outputSchema: convertOutputSchema(
            mode === 'grid' ? GridResponseSchema : TilingResponseSchema,
          ),
          stream: false,
          debug: false,
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
      const planner = llmPlanner({ adapter: dummyAdapter });
      let retry: RetryFeedback | undefined;

      const engine = createEngine({
        planner: (attempt: Retryable<PlanningInput>, ctx) => {
          retry = attempt.retry;
          return planner(attempt, ctx);
        },
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
      expect(chatCall(0).threadId).toBe(input.sessionId);
      expect(chatCall(1).threadId).toBe(input.sessionId);
      expect(chatCall(1).systemPrompts).toEqual(chatCall(0).systemPrompts);
      if (retry === undefined)
        throw new Error('second attempt must be a retry');
      expect(retry.diagnostics.feedback).toContain('exceeds chart bounds');
      expect(chatCall(1).messages).toEqual([
        {
          role: 'user',
          content: buildRetryPrompt(
            buildUserPrompt(request),
            retry.diagnostics,
          ),
        },
      ]);
    });

    test('invokes chat() with the expected options', async () => {
      mockChat.mockResolvedValueOnce(buildGridResponse());

      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter }),
        logger: silentLogger,
      });
      await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request: makeGridRequest(),
        }),
      );

      expect(mockChat).toHaveBeenCalledTimes(1);
      const callArgs = chatCall(0);
      expect(callArgs).toHaveProperty('adapter', dummyAdapter);
      expect(callArgs).toHaveProperty('stream', false);
      expect(callArgs).toHaveProperty('outputSchema');
      expect(callArgs).toHaveProperty('systemPrompts');
      expect(callArgs).toHaveProperty('messages');
    });

    test('passes an AbortController through to chat()', async () => {
      mockChat.mockResolvedValueOnce(buildGridResponse());

      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter }),
        logger: silentLogger,
      });
      await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request: makeGridRequest(),
        }),
      );

      expect(chatCall(0).abortController).toBeInstanceOf(AbortController);
    });

    test('applies prompt options from config', async () => {
      mockChat.mockResolvedValueOnce(buildGridResponse());

      const engine = createEngine({
        planner: llmPlanner({
          adapter: dummyAdapter,
          prompt: { system: { identity: 'You are a custom assistant.' } },
        }),
        logger: silentLogger,
      });
      const result = await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request: makeGridRequest(),
        }),
      );
      expect(isOk(result)).toBe(true);

      const systemPrompts = chatCall(0).systemPrompts;
      expect(systemPrompts[0]).toContain('You are a custom assistant.');
      expect(systemPrompts[0]).not.toContain('You are Maelstrom');
    });

    test('reuses the exact prompt enum snapshot for stateful toJSON validation', async () => {
      let toJSONCalls = 0;
      const statefulValue = {
        toJSON: () => ({ id: ++toJSONCalls }),
      };
      const base = makeGridRequest();
      const calendar = base.vessels[0];
      expect(calendar).toBeDefined();
      if (calendar === undefined) return;
      const month = calendar.variants[calendar.defaultVariant];
      expect(month).toBeDefined();
      if (month === undefined) return;
      const showWeek = month.actions[0];
      expect(showWeek).toBeDefined();
      if (showWeek === undefined) return;

      const request: ChartRequest = {
        ...base,
        vessels: [
          {
            ...calendar,
            variants: {
              ...calendar.variants,
              [calendar.defaultVariant]: {
                ...month,
                actions: [
                  {
                    ...showWeek,
                    parameters: [
                      {
                        name: 'selection',
                        type: 'object',
                        description: 'Selected view',
                        enum: [statefulValue],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      };
      const action = {
        instanceId: 'calendar-main',
        action: 'showWeek',
        paramsJson: '{"selection":{"id":1}}',
      };
      mockChat.mockResolvedValueOnce(
        buildGridResponse({
          executionPlan: [action],
          layout: {
            positions: [
              {
                instanceId: 'calendar-main',
                position: { row: 0, column: 0 },
                size: { width: 15, height: 4 },
              },
            ],
          },
        }),
      );
      mockChat.mockResolvedValueOnce(
        buildGridResponse({ executionPlan: [action] }),
      );

      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter }),
        logger: silentLogger,
        retry: { max: 1 },
      });
      const result = await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request,
        }),
      );

      expect(isOk(result)).toBe(true);
      if (!isOk(result) || result.value.type !== 'chart_response') return;
      expect(mockChat).toHaveBeenCalledTimes(2);
      expect(toJSONCalls).toBe(1);
      expect(chatCall(0).messages.at(-1)?.content).toContain(
        'selection: {"id":1}',
      );
      expect(chatCall(1).messages.at(-1)?.content).toContain(
        'selection: {"id":1}',
      );
      expect(chatCall(1).messages.at(-1)?.content).not.toContain(
        'had invalid params',
      );
      expect(result.value.response.executionPlan).toEqual([
        {
          instanceId: InstanceId('calendar-main'),
          action: ActionName('showWeek'),
          params: { selection: { id: 1 } },
        },
      ]);
    });

    test('a retry prompt built from a params_parse_failed diagnostic reflects that reason, not a layout overflow', async () => {
      // Companion to the position-overflow retry-prompt assertion above:
      // pins that the retry prompt's content tracks the diagnostic's actual
      // shape rather than always describing a layout drop. The engine-level
      // retry mechanics (attempt count, `retry.diagnostics` plumbing) are
      // covered in engine.test.ts through a generic Planner; this test owns
      // the prompt-content half, which only llmPlanner produces.
      const actionEmptyResponse = buildGridResponse({
        executionPlan: [
          {
            instanceId: 'calendar-main',
            action: 'showWeek',
            paramsJson: '{not valid json',
          },
        ],
      });
      mockChat.mockResolvedValueOnce(actionEmptyResponse);
      mockChat.mockResolvedValueOnce(buildGridResponse());

      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter }),
        logger: silentLogger,
        retry: { max: 3 },
      });
      const result = await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request: makeGridRequest(),
        }),
      );

      expect(isOk(result)).toBe(true);
      expect(mockChat).toHaveBeenCalledTimes(2);

      const lastUserMessage = chatCall(1).messages.at(-1)?.content ?? '';
      expect(lastUserMessage).toContain('unparseable params');
      expect(lastUserMessage).not.toContain('exceeds chart bounds');
    });

    test('returns ProviderError when chat() rejects with an Error', async () => {
      mockChat.mockRejectedValueOnce(new Error('LLM service unavailable'));

      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter }),
        logger: silentLogger,
      });
      const result = await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request: makeGridRequest(),
        }),
      );

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('ProviderError');
      expect(result.error.message).toBe('LLM service unavailable');
    });

    test('returns ProviderError when chat() rejects with a non-Error value', async () => {
      mockChat.mockRejectedValueOnce('rate limited');

      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter }),
        logger: silentLogger,
      });
      const result = await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request: makeGridRequest(),
        }),
      );

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('ProviderError');
      expect(result.error.message).toBe('rate limited');
    });

    test('returns CancellationError when the signal is already aborted', async () => {
      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter }),
        logger: silentLogger,
      });

      const controller = new AbortController();
      controller.abort('user cancel');

      const result = await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request: makeGridRequest(),
        }),
        controller.signal,
      );

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('CancellationError');
      expect(mockChat).not.toHaveBeenCalled();
    });

    test('returns CancellationError when the signal aborts during chat()', async () => {
      const controller = new AbortController();
      mockChat.mockImplementationOnce(() => {
        controller.abort('timed out');
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      });

      const engine = createEngine({
        planner: llmPlanner({ adapter: dummyAdapter }),
        logger: silentLogger,
      });
      const result = await engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('session-1'),
          id: MessageId('req-1'),
          request: makeGridRequest(),
        }),
        controller.signal,
      );

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('CancellationError');
    });

    test('stops the provider request when the caller cancels to avoid unused model work', async () => {
      const controller = new AbortController();
      let providerSignal: AbortSignal | undefined;
      mockChat.mockImplementationOnce((options) => {
        const { abortController } = options as ChatArgs;
        providerSignal = abortController.signal;
        controller.abort('superseded');
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      });

      const input = makePlanningInput(makeGridRequest());
      const result = await llmPlanner({ adapter: dummyAdapter })(
        input,
        makeStageContext({ origin: input, signal: controller.signal }),
      );

      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(providerSignal?.aborted).toBe(true);
      expect(providerSignal?.reason).toBe('superseded');
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: 'CancellationError', reason: 'superseded' },
      });
    });

    test('rejects a cancelled response even when the provider ignores the abort', async () => {
      const controller = new AbortController();
      mockChat.mockImplementationOnce(() => {
        controller.abort('superseded');
        return Promise.resolve(buildGridResponse());
      });
      const input = makePlanningInput(makeGridRequest());
      const result = await llmPlanner({ adapter: dummyAdapter })(
        input,
        makeStageContext({ origin: input, signal: controller.signal }),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: 'CancellationError', reason: 'superseded' },
      });
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
    const diagnostics = overflowDiagnostics;

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

    test('a retry with different hints rebuilds the original prompt with the new hints', async () => {
      mockChat.mockResolvedValue(buildGridResponse());
      const request = makeGridRequest();
      const input = makePlanningInput(request);
      const ctx = makeStageContext({ origin: input });
      const diagnostics = overflowDiagnostics;
      const planner = llmPlanner({ adapter: dummyAdapter });

      await planner({ ...input, hints: ['A'] }, ctx);
      await planner(
        {
          ...input,
          hints: ['B'],
          retry: { attempt: 1, previous: overflowingResponse, diagnostics },
        },
        ctx,
      );

      expect(chatCall(1).messages.at(-1)?.content).toBe(
        buildRetryPrompt(
          `${buildUserPrompt(request)}\n\n## Planner Hints\n\n- B`,
          diagnostics,
        ),
      );
    });

    test('a retry with the same hints array reuses the original prompt', async () => {
      mockChat.mockResolvedValue(buildGridResponse());
      const request = makeGridRequest();
      const hints = ['A'];
      const input = { ...makePlanningInput(request), hints };
      const ctx = makeStageContext({ origin: input });
      const diagnostics = overflowDiagnostics;
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

      await planner(input, ctx);
      await planner(
        {
          ...input,
          retry: { attempt: 1, previous: overflowingResponse, diagnostics },
        },
        ctx,
      );

      expect(customizerCalls).toBe(1);
      expect(chatCall(1).messages.at(-1)?.content).toBe(
        buildRetryPrompt(
          `${buildUserPrompt(request)}\n\n## Planner Hints\n\n- A`,
          diagnostics,
        ),
      );
    });

    test('carry into the retry prompt as part of the original request', async () => {
      mockChat.mockResolvedValue(buildGridResponse());
      const request = makeGridRequest();
      const hints = ['Prefer the calendar'];
      const input = { ...makePlanningInput(request), hints };
      const ctx = makeStageContext({ origin: input });
      const diagnostics = overflowDiagnostics;

      await llmPlanner({ adapter: dummyAdapter })(
        {
          ...input,
          retry: { attempt: 1, previous: overflowingResponse, diagnostics },
        },
        ctx,
      );

      const retryPrompt = chatCall(0).messages.at(-1)?.content;
      expect(retryPrompt).toBe(
        buildRetryPrompt(
          `${buildUserPrompt(request)}\n\n## Planner Hints\n\n- Prefer the calendar`,
          diagnostics,
        ),
      );
      expect(typeof retryPrompt).toBe('string');
      if (typeof retryPrompt !== 'string') return;
      const feedbackAt = retryPrompt.indexOf('exceeds chart bounds');
      const originalAt = retryPrompt.indexOf('Original request:');
      const hintsAt = retryPrompt.indexOf('- Prefer the calendar');
      expect(feedbackAt).toBeGreaterThan(-1);
      expect(originalAt).toBeGreaterThan(feedbackAt);
      expect(hintsAt).toBeGreaterThan(originalAt);
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

describe('llmPlanner instrumentation', () => {
  function spyInstrument(): {
    instrument: Instrument;
    events: { name: string; attributes: InstrumentAttributes }[];
  } {
    const events: { name: string; attributes: InstrumentAttributes }[] = [];
    return {
      events,
      instrument: {
        stage: (_name, stage) => stage,
        event: (name, attributes) => events.push({ name, attributes }),
      },
    };
  }

  test('keeps token accounting local to overlapping requests on one planner', async () => {
    const planner = llmPlanner({ adapter: dummyAdapter });
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockChat.mockImplementationOnce(async (options) => {
      await reportUsage((options as ChatArgs).middleware[0], {
        promptTokens: 12,
        completionTokens: 3,
        totalTokens: 15,
        promptTokensDetails: { cachedTokens: 8, cacheWriteTokens: 4 },
        cost: 0.01,
      });
      await barrier;
      return buildGridResponse();
    });
    mockChat.mockImplementationOnce(async (options) => {
      await reportUsage((options as ChatArgs).middleware[0], {
        promptTokens: 40,
        completionTokens: 10,
        totalTokens: 50,
        promptTokensDetails: { cachedTokens: 30, cacheWriteTokens: 0 },
        cost: 0.03,
      });
      release();
      return buildGridResponse();
    });
    const first = { ...makePlanningInput(), messageId: MessageId('first') };
    const second = { ...makePlanningInput(), messageId: MessageId('second') };
    const { instrument, events } = spyInstrument();
    const results = await Promise.all([
      planner(first, makeStageContext({ origin: first, instrument })),
      planner(second, makeStageContext({ origin: second, instrument })),
    ]);
    expect(results.every(isOk)).toBe(true);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.name)).toEqual(['llm.call', 'llm.call']);
    const attributes = (messageId: string) =>
      events.find(
        (event) => event.attributes['maelstrom.message_id'] === messageId,
      )?.attributes;
    expect(attributes('first')).toMatchObject({
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
      'gen_ai.usage.cache_read.input_tokens': 8,
      'gen_ai.usage.cache_creation.input_tokens': 4,
      'gen_ai.usage.cost': 0.01,
    });
    expect(attributes('second')).toMatchObject({
      'gen_ai.usage.input_tokens': 40,
      'gen_ai.usage.output_tokens': 10,
      'gen_ai.usage.cache_read.input_tokens': 30,
      'gen_ai.usage.cache_creation.input_tokens': 0,
      'gen_ai.usage.cost': 0.03,
    });
    mockChat.mockResolvedValueOnce(buildGridResponse());
    const third = { ...makePlanningInput(), messageId: MessageId('third') };
    expect(
      isOk(
        await planner(third, makeStageContext({ origin: third, instrument })),
      ),
    ).toBe(true);
    expect(events).toHaveLength(3);
    expect(attributes('third')).not.toHaveProperty('gen_ai.usage.input_tokens');
    expect(attributes('third')).not.toHaveProperty(
      'gen_ai.usage.output_tokens',
    );
    expect(attributes('third')).not.toHaveProperty(
      'gen_ai.usage.cache_read.input_tokens',
    );
    expect(attributes('third')).not.toHaveProperty(
      'gen_ai.usage.cache_creation.input_tokens',
    );
    expect(attributes('third')).not.toHaveProperty('gen_ai.usage.cost');
  });

  test('counts a failed provider run once when terminal usage is repeated', async () => {
    mockChat.mockImplementationOnce(async (options) => {
      const middleware = (options as ChatArgs).middleware[0];
      await reportUsage(middleware, {
        promptTokens: 12,
        completionTokens: 3,
        totalTokens: 15,
      });
      await middleware?.onChunk?.({} as never, {
        type: 'RUN_ERROR' as RunErrorEvent['type'],
        message: 'private-provider-key',
        timestamp: 2,
        usage: [{ inputTokens: 12, outputTokens: 3, totalTokens: 15 }],
      });
      throw new Error('private-provider-key');
    });
    const { instrument, events } = spyInstrument();
    const result = await llmPlanner({ adapter: dummyAdapter })(
      makePlanningInput(),
      makeStageContext({ instrument }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: 'ProviderError' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
      'maelstrom.outcome': 'error',
    });
    expect(JSON.stringify(events)).not.toContain('private-provider-key');
  });

  test('reports a successful model call with the adapter model and latency', async () => {
    mockChat.mockResolvedValueOnce(buildGridResponse());
    const { instrument, events } = spyInstrument();

    const result = await llmPlanner({ adapter: dummyAdapter })(
      makePlanningInput(),
      makeStageContext({ instrument }),
    );

    expect(isOk(result)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('llm.call');
    expect(events[0]?.attributes).toMatchObject({
      'gen_ai.request.model': 'dummy-model',
      'maelstrom.outcome': 'ok',
    });
    expect(typeof events[0]?.attributes['maelstrom.latency_ms']).toBe('number');
    expect(Object.keys(events[0]?.attributes ?? {}).sort()).toEqual([
      'gen_ai.request.model',
      'maelstrom.latency_ms',
      'maelstrom.message_id',
      'maelstrom.outcome',
      'maelstrom.session_id',
    ]);
  });

  test('sums reported usage without counting normalized hooks again', async () => {
    mockChat.mockImplementationOnce(async (options) => {
      const middleware = (options as ChatArgs).middleware[0];
      for (const usage of [
        {
          promptTokens: 12,
          completionTokens: 3,
          totalTokens: 15,
          promptTokensDetails: { cachedTokens: 8, cacheWriteTokens: 2 },
          cost: 0.01,
        },
        {
          promptTokens: 4,
          completionTokens: 2,
          totalTokens: 6,
          promptTokensDetails: { cachedTokens: 0, cacheWriteTokens: 4 },
          cost: 0.03,
        },
      ])
        await reportUsage(middleware, usage);
      return buildGridResponse();
    });
    const { instrument, events } = spyInstrument();
    await llmPlanner({ adapter: dummyAdapter })(
      makePlanningInput(),
      makeStageContext({ instrument }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 16,
      'gen_ai.usage.output_tokens': 5,
      'gen_ai.usage.cache_read.input_tokens': 8,
      'gen_ai.usage.cache_creation.input_tokens': 6,
      'gen_ai.usage.cost': 0.04,
      'maelstrom.message_id': 'req-1',
      'maelstrom.session_id': 'session-1',
      'maelstrom.outcome': 'ok',
    });
  });

  test('keeps reported usage when finalization fails so failed work is not free', async () => {
    mockChat.mockImplementationOnce(async (options) => {
      await reportUsage((options as ChatArgs).middleware[0], {
        promptTokens: 12,
        completionTokens: 3,
        totalTokens: 15,
      });
      throw new Error('invalid structured output');
    });
    const { instrument, events } = spyInstrument();
    await llmPlanner({ adapter: dummyAdapter })(
      makePlanningInput(),
      makeStageContext({ instrument }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
      'maelstrom.outcome': 'error',
    });
  });

  test('reports a failed model call as an error', async () => {
    mockChat.mockRejectedValueOnce(new Error('LLM service unavailable'));
    const { instrument, events } = spyInstrument();

    await llmPlanner({ adapter: dummyAdapter })(
      makePlanningInput(),
      makeStageContext({ instrument }),
    );

    expect(
      events.map((event) => event.attributes['maelstrom.outcome']),
    ).toEqual(['error']);
  });

  test('reports a cancelled model call as cancelled', async () => {
    const controller = new AbortController();
    controller.abort('user cancel');
    const { instrument, events } = spyInstrument();

    await llmPlanner({ adapter: dummyAdapter })(
      makePlanningInput(),
      makeStageContext({ instrument, signal: controller.signal }),
    );

    expect(
      events.map((event) => event.attributes['maelstrom.outcome']),
    ).toEqual(['cancelled']);
  });
});
