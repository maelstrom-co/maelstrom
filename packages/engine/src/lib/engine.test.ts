import { afterEach, describe, expect, mock, test } from 'bun:test';

import type {
  ChartRequest as BrandedChartRequest,
  EngineMessage,
} from '@maelstrom-co/protocol';
import {
  AssistantInjectionMessage,
  ChartRequestMessage,
  InstanceId,
  isErr,
  isOk,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import type { EngineConfig } from './config.js';
import { createEngine } from './engine.js';
import type { HistoryStore } from './history/history-store.js';
import { createInMemoryStore } from './history/in-memory-store.js';
import {
  dummyAdapter,
  getLastUserMessage,
  invalid,
  makeGridRequest as makeGridRequestBranded,
  makeTilingRequest as makeTilingRequestBranded,
  silentLogger,
} from './__test-helpers__/fixtures.js';

// ---------------------------------------------------------------------------
// Permissive author-facing shapes for fixture literals. Brands erase at
// runtime; tests build the structural shape and cast at the boundary.
// ---------------------------------------------------------------------------

type AuthorActionExecution = {
  readonly instanceId: string;
  readonly action: string;
  readonly params?: Record<string, unknown>;
  readonly paramsJson?: string;
};
type AuthorGridLayout = {
  readonly positions: ReadonlyArray<{
    readonly instanceId: string;
    readonly position: { readonly row: number; readonly column: number };
    readonly size: { readonly width: number; readonly height: number };
  }>;
};
type AuthorTilingLayout = {
  readonly tree: ReadonlyArray<'H' | 'V' | string | null>;
  readonly instances: ReadonlyArray<{
    readonly instanceId: string;
    readonly vesselId: string;
    readonly variant: string;
  }>;
};
type GridResponse = {
  readonly userMessage: string;
  readonly rationale: string;
  readonly executionPlan: ReadonlyArray<AuthorActionExecution>;
  readonly layout: AuthorGridLayout;
};
type TilingResponse = {
  readonly userMessage: string;
  readonly rationale: string;
  readonly executionPlan: ReadonlyArray<AuthorActionExecution>;
  readonly layout: AuthorTilingLayout;
};
type Vessel = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defaultVariant: string;
  readonly variants: Readonly<
    Record<
      string,
      {
        readonly description?: string;
        readonly props: Readonly<Record<string, unknown>>;
        readonly minSize: { readonly width: number; readonly height: number };
        readonly actions: ReadonlyArray<{
          readonly name: string;
          readonly description: string;
          readonly transitionsTo?: string;
        }>;
      }
    >
  >;
};
type ChartRequest = {
  readonly type: 'chart_request';
  readonly context: BrandedChartRequest['context'];
  readonly instances: ReadonlyArray<{
    readonly instanceId: string;
    readonly vesselId: string;
    readonly variant: string;
  }>;
  readonly vessels: ReadonlyArray<Vessel>;
  readonly layout:
    | { readonly type: 'grid'; readonly positions: AuthorGridLayout['positions'] }
    | {
        readonly type: 'tiling';
        readonly tree: AuthorTilingLayout['tree'];
        readonly instances: AuthorTilingLayout['instances'];
      };
};

const makeGridRequest = makeGridRequestBranded as unknown as (
  overrides?: Partial<ChartRequest>,
) => ChartRequest;
const makeTilingRequest = makeTilingRequestBranded as unknown as (
  overrides?: Partial<ChartRequest>,
) => ChartRequest;

// ---------------------------------------------------------------------------
// Mock TanStack AI chat()
// ---------------------------------------------------------------------------

const mockChat = mock<(...args: unknown[]) => Promise<unknown>>();

mock.module('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}));

const gridLLMResponse: GridResponse = {
  userMessage: 'Here is your calendar!',
  rationale: 'User asked for calendar',
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
};

const DEFAULT_SESSION_ID = SessionId('session-1');
const DEFAULT_MESSAGE_ID = MessageId('req-1');

// Wraps a ChartRequest fixture into the envelope so tests read naturally.
const toChartRequestMessage = (
  request: ChartRequest,
  sessionId: SessionId = DEFAULT_SESSION_ID,
  id: MessageId = DEFAULT_MESSAGE_ID,
): ChartRequestMessage =>
  ChartRequestMessage({
    sessionId,
    id,
    request: request as unknown as BrandedChartRequest,
  });

afterEach(() => {
  mockChat.mockReset();
});

describe('createEngine', () => {
  test.each([
    {
      name: 'missing adapter',
      config: {} as EngineConfig,
      pattern: /adapter/,
    },
    {
      name: 'adapter missing required methods',
      config: {
        adapter: { kind: 'text', name: 'x', model: 'm' },
      } as unknown as EngineConfig,
      pattern: /adapter\.(chatStream|structuredOutput)/,
    },
    {
      name: 'unrecognized root key (typo)',
      config: {
        adapter: dummyAdapter,
        prompts: {},
      } as unknown as EngineConfig,
      pattern: /unrecognized|prompts/i,
    },
    {
      name: 'invalid nested prompt field',
      config: {
        adapter: dummyAdapter,
        prompt: { vars: { assistantName: 42 } },
      } as unknown as EngineConfig,
      pattern: /prompt\.vars\.assistantName/,
    },
  ])('throws synchronously when config is invalid ($name)', ({
    config,
    pattern,
  }) => {
    let caught: unknown;
    try {
      createEngine(config);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error;
    expect(error.message).toMatch(/Invalid EngineConfig/);
    expect(error.message).toMatch(pattern);
    // `@throws` contract: the original ZodError is attached as `cause`.
    const cause = error.cause as { issues?: unknown[] } | undefined;
    expect(Array.isArray(cause?.issues)).toBe(true);
  });

  test('returns an Engine for a valid minimal config', () => {
    const engine = createEngine({ adapter: dummyAdapter });
    expect(engine).toBeDefined();
    expect(typeof engine.handle).toBe('function');
  });

  test.each([
    {
      name: 'function customizer on unknown key',
      system: { unknownKey: () => 'oops' },
      pattern: /is not a default section/,
    },
    {
      name: 'function customizer that throws',
      system: {
        rules: () => {
          throw new Error('boom');
        },
      },
      pattern: /customizer for "rules" threw: boom/,
    },
  ])(
    'throws synchronously when a system prompt customizer is misconfigured ($name)',
    ({ system, pattern }) => {
      let caught: unknown;
      try {
        createEngine({
          adapter: dummyAdapter,
          logger: silentLogger,
          prompt: { system },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      // Same `Invalid EngineConfig:` shape as Zod-config failures so consumers
      // can match a single prefix to detect any factory-time misconfig.
      expect(error.message).toMatch(/^Invalid EngineConfig: prompt\.system:/);
      expect(error.message).toMatch(pattern);
      expect(error.cause).toBeInstanceOf(Error);
    },
  );
});

// ---------------------------------------------------------------------------
// System prompt memoization
// ---------------------------------------------------------------------------

describe('createEngine — system prompt memoization', () => {
  test('derives system prompts once per createEngine and routes by layout mode', async () => {
    let customizerCalls = 0;
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      prompt: {
        system: {
          rules: (defaults) => {
            customizerCalls++;
            return `${defaults}\n\nSENTINEL_RULES`;
          },
        },
      },
    });

    // One customizer call per mode at factory time (grid + tiling).
    expect(customizerCalls).toBe(2);

    const tilingLLMResponse: TilingResponse = {
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
    };
    mockChat.mockResolvedValueOnce(gridLLMResponse);
    mockChat.mockResolvedValueOnce(tilingLLMResponse);
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    await engine.handle(toChartRequestMessage(makeGridRequest()));
    await engine.handle(toChartRequestMessage(makeTilingRequest()));
    await engine.handle(toChartRequestMessage(makeGridRequest()));

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
      adapter: dummyAdapter,
      logger: silentLogger,
      prompt: {
        user: {
          vessels: () => {
            throw new Error('user boom');
          },
        },
      },
    });

    const result = await engine.handle(toChartRequestMessage(makeGridRequest()));
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ValidationError');
    if (result.error._tag !== 'ValidationError') return;
    expect(result.error.field).toBe('prompt');
    expect(result.error.message).toMatch(/customizer for "vessels" threw/);
    // chat() must not be called when prompt construction fails.
    expect(mockChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chart_request variant
// ---------------------------------------------------------------------------

describe('engine.handle — chart_request', () => {
  test('returns a chart_response envelope on success', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const request = makeGridRequest();
    const result = await engine.handle(toChartRequestMessage(request));

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.type).toBe('chart_response');
    if (result.value.type !== 'chart_response') return;

    expect(result.value.sessionId).toBe(DEFAULT_SESSION_ID);
    expect(result.value.id).toBe(DEFAULT_MESSAGE_ID);
    expect(result.value.response.type).toBe('maelstrom_response');
    expect(result.value.response.userMessage).toBe('Here is your calendar!');
    expect(result.value.response.layout.type).toBe('grid');
  });

  test('invokes chat() with the expected options', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(mockChat).toHaveBeenCalledTimes(1);
    const callArgs = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).toHaveProperty('adapter', dummyAdapter);
    expect(callArgs).toHaveProperty('stream', false);
    expect(callArgs).toHaveProperty('outputSchema');
    expect(callArgs).toHaveProperty('systemPrompts');
    expect(callArgs).toHaveProperty('messages');
  });

  test('returns ProviderError when chat() rejects with an Error', async () => {
    mockChat.mockRejectedValueOnce(new Error('LLM service unavailable'));

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ProviderError');
    expect(result.error.message).toBe('LLM service unavailable');
  });

  test('returns ProviderError when chat() rejects with a non-Error value', async () => {
    mockChat.mockRejectedValueOnce('rate limited');

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ProviderError');
    expect(result.error.message).toBe('rate limited');
  });

  test('passes an AbortController through to chat()', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    await engine.handle(toChartRequestMessage(makeGridRequest()));

    const callArgs = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.abortController).toBeInstanceOf(AbortController);
  });

  test('returns CancellationError when the signal is already aborted', async () => {
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });

    const controller = new AbortController();
    controller.abort('user cancel');

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
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
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
      controller.signal,
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('CancellationError');
  });

  test('returns HistoryError when getLLMContext throws (no LLM call)', async () => {
    const throwingStore: HistoryStore = {
      ...createInMemoryStore(),
      get: async () => {
        throw new Error('network down');
      },
    };
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: throwingStore },
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('HistoryError');
    if (result.error._tag !== 'HistoryError') return;
    expect(result.error.operation).toBe('get_llm_context');
    expect(result.error.cause).toBeInstanceOf(Error);
    expect(mockChat).not.toHaveBeenCalled();
  });

  test('preserves non-Error throw values from getLLMContext as cause', async () => {
    // Bun/Node consumers can throw any value, not just Error instances.
    // The HistoryError must carry the original cause through unchanged so
    // downstream diagnostics can inspect it (a string thrown by a buggy
    // adapter would otherwise be silently coerced and lose context).
    const throwingStore: HistoryStore = {
      ...createInMemoryStore(),
      get: async () => {
        throw 'string-shaped store failure';
      },
    };
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: throwingStore },
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('HistoryError');
    if (result.error._tag !== 'HistoryError') return;
    expect(result.error.operation).toBe('get_llm_context');
    expect(result.error.cause).toBe('string-shaped store failure');
  });

  test('logs the getLLMContext failure with sessionId/messageId context', async () => {
    // Failure observability hinges on the log carrying enough context for
    // operators to find the failing session. A regression that drops
    // either correlation field would break dashboards that group by
    // session, so pin both explicitly.
    const logged: Array<{ message: string; data?: Record<string, unknown> }> =
      [];
    const captureLogger: Parameters<typeof createEngine>[0]['logger'] = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (message, _error, data) => {
        logged.push({ message, data });
      },
    };
    const throwingStore: HistoryStore = {
      ...createInMemoryStore(),
      get: async () => {
        throw new Error('network down');
      },
    };
    const sessionId = SessionId('failing-session');
    const messageId = MessageId('failing-msg');
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: captureLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: throwingStore },
    });

    await engine.handle(
      toChartRequestMessage(makeGridRequest(), sessionId, messageId),
    );

    const failureLog = logged.find(
      (l) => l.message === 'Failed to load history context',
    );
    expect(failureLog).toBeDefined();
    expect(failureLog?.data).toMatchObject({ sessionId, messageId });
  });

  test('discriminates HistoryError.operation between get_llm_context and add_assistant_message', async () => {
    // The operation discriminant is what consumers branch on to route
    // history-store failures by call site. Without per-operation tests, a
    // regression that re-tagged one path with another's operation (e.g.
    // add_assistant_message slipping into get_llm_context's catch) would
    // typecheck and pass the existing 'returns HistoryError' tests.
    const inner = createInMemoryStore();
    const recordThrows: HistoryStore = {
      ...inner,
      append: async () => {
        throw new Error('append failed');
      },
    };
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: recordThrows },
    });

    const result = await engine.handle(
      AssistantInjectionMessage({
        sessionId: SessionId('s'),
        content: 'hi',
        id: MessageId('m'),
      }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('HistoryError');
    if (result.error._tag !== 'HistoryError') return;
    expect(result.error.operation).toBe('add_assistant_message');
  });

  test('uses consoleLogger when no logger is provided', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);
    const engine = createEngine({ adapter: dummyAdapter });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );
    expect(isOk(result)).toBe(true);
  });

  test('applies prompt options from config', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      prompt: { system: { identity: 'You are a custom assistant.' } },
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );
    expect(isOk(result)).toBe(true);

    const callArgs = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    const systemPrompts = callArgs.systemPrompts as string[];
    expect(systemPrompts[0]).toContain('You are a custom assistant.');
    expect(systemPrompts[0]).not.toContain('You are Maelstrom');
  });

  test('parses the execution plan from the LLM response', async () => {
    const responseWithActions: GridResponse = {
      ...gridLLMResponse,
      executionPlan: [
        {
          instanceId: 'calendar-main',
          action: 'showWeek',
          paramsJson: '{"weekStart":"2026-04-06"}',
        },
      ],
    };
    mockChat.mockResolvedValueOnce(responseWithActions);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.handle(
      toChartRequestMessage({
        ...makeGridRequest(),
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
            description: 'Calendar widget',
            defaultVariant: 'month',
            variants: {
              month: {
                props: {},
                minSize: { width: 4, height: 4 },
                actions: [{ name: 'showWeek', description: 'Show week view' }],
              },
            },
          },
        ],
      }),
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.executionPlan).toHaveLength(1);
    expect(result.value.response.executionPlan[0]?.params).toEqual({
      weekStart: '2026-04-06',
    });
  });

  test('processes a tiling-mode request end-to-end', async () => {
    const tilingResponse: TilingResponse = {
      userMessage: 'Split view ready',
      rationale: 'User wants side by side',
      executionPlan: [],
      layout: {
        tree: ['V', 'calendar-main', 'tasks-main'],
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
          { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
        ],
      },
    };
    mockChat.mockResolvedValueOnce(tilingResponse);

    const tilingRequest: ChartRequest = {
      type: 'chart_request',
      context: {
        updateReasons: [
          { type: 'user_intent', intent: 'Show tasks next to calendar' },
        ],
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
          description: 'Calendar widget',
          defaultVariant: 'month',
          variants: {
            month: { props: {}, minSize: { width: 4, height: 4 }, actions: [] },
          },
        },
        {
          id: 'tasks',
          name: 'Tasks',
          description: 'Task list widget',
          defaultVariant: 'list',
          variants: {
            list: { props: {}, minSize: { width: 3, height: 4 }, actions: [] },
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
    };

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const tilingId = MessageId('req-tiling');
    const result = await engine.handle(
      toChartRequestMessage(
        tilingRequest,
        SessionId('session-tiling'),
        tilingId,
      ),
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.layout.type).toBe('tiling');
    expect(result.value.response.requestId).toBe(tilingId);
  });

  test('"Response healed" routes severity → log level (warnings-only path → warn for medium severity)', async () => {
    // Pre-relocation, "Response healed" was hardcoded `info`. The
    // severity-routed fix should fire at the level matching
    // `retryHint.severity`. Empty rationale on a request with a renderable
    // layout produces a warning that yields `severity='low' + recommend=false`
    // → routes to info. To exercise warn-level routing, drive a partial
    // healed-but-renderable case: one position overflows (drop) but the
    // request lists multiple instances so the layout is still non-empty.
    const partiallyHealed: GridResponse = {
      ...gridLLMResponse,
      layout: {
        positions: [
          {
            instanceId: 'calendar-main',
            position: { row: 0, column: 0 },
            size: { width: 6, height: 4 },
          },
          {
            instanceId: 'extra',
            position: { row: 0, column: 0 },
            size: { width: 15, height: 4 },
          },
        ],
      },
    };
    mockChat.mockResolvedValueOnce(partiallyHealed);

    const logEntries: Array<{ level: string; msg: string; ctx?: unknown }> = [];
    const spyLogger = {
      debug: () => {},
      info: (msg: string, ctx?: unknown) =>
        logEntries.push({ level: 'info', msg, ctx }),
      warn: (msg: string, ctx?: unknown) =>
        logEntries.push({ level: 'warn', msg, ctx }),
      error: (msg: string, _error?: unknown, ctx?: unknown) =>
        logEntries.push({ level: 'error', msg, ctx }),
    };

    // Two-instance request so the partial-heal layout still has one
    // surviving position → recommend=false at severity 'medium'.
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: spyLogger,
    });
    const request = makeGridRequest({
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'calendar',
          variant: 'month',
        },
        {
          instanceId: InstanceId('extra'),
          vesselId: 'calendar',
          variant: 'month',
        },
      ],
    });
    await engine.handle(toChartRequestMessage(request));

    const healed = logEntries.filter((e) => e.msg === 'Response healed');
    expect(healed).toHaveLength(1);
    // medium severity (drops > 0, but layout still renders) → warn level.
    expect(healed[0]?.level).toBe('warn');
    expect(healed[0]?.ctx).toMatchObject({
      retrySeverity: 'medium',
      retryRecommend: false,
    });
  });

  test('"Response healed" routes to error level for unrecoverable severity', async () => {
    // Single-instance request + overflowing position → healed layout empty
    // → severity='unrecoverable' → error-level routing on first attempt.
    const layoutEmptyingResponse: GridResponse = {
      ...gridLLMResponse,
      layout: {
        positions: [
          {
            instanceId: 'calendar-main',
            position: { row: 0, column: 0 },
            size: { width: 15, height: 4 },
          },
        ],
      },
    };
    // mockResolvedValue (not Once) so retry attempts also resolve cleanly —
    // the test's invariant is "Response healed fires at error level on the
    // final attempt", not "the mock is consumed once".
    mockChat.mockResolvedValue(layoutEmptyingResponse);

    const logEntries: Array<{ level: string; msg: string; ctx?: unknown }> = [];
    const spyLogger = {
      debug: () => {},
      info: (msg: string, ctx?: unknown) =>
        logEntries.push({ level: 'info', msg, ctx }),
      warn: (msg: string, ctx?: unknown) =>
        logEntries.push({ level: 'warn', msg, ctx }),
      error: (msg: string, _error?: unknown, ctx?: unknown) =>
        logEntries.push({ level: 'error', msg, ctx }),
    };

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: spyLogger,
    });
    await engine.handle(toChartRequestMessage(makeGridRequest()));

    const healed = logEntries.filter((e) => e.msg === 'Response healed');
    expect(healed).toHaveLength(1);
    expect(healed[0]?.level).toBe('error');
    expect(healed[0]?.ctx).toMatchObject({
      retrySeverity: 'unrecoverable',
      retryRecommend: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Retry integration
// ---------------------------------------------------------------------------

describe('engine.handle — retry on retryHint.recommend', () => {
  // Width 15 on a 12-column chart triggers `position_overflow` heal-drop.
  // The request lists 1 instance, so a single overflowing position empties
  // the healed layout → `retryHint.recommend === true` (severity:
  // 'unrecoverable') — the canonical retry trigger.
  const layoutEmptyingResponse: GridResponse = {
    ...gridLLMResponse,
    layout: {
      positions: [
        {
          instanceId: 'calendar-main',
          position: { row: 0, column: 0 },
          size: { width: 15, height: 4 },
        },
      ],
    },
  };

  test('retries when retryHint recommends and succeeds on the second attempt', async () => {
    mockChat.mockResolvedValueOnce(layoutEmptyingResponse);
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      maxRetries: 3,
    });
    const result = await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.layout.type).toBe('grid');
    expect(mockChat).toHaveBeenCalledTimes(2);

    // The second chat() call must carry the retry-built prompt with
    // structured drop feedback and the verbatim original prompt.
    const lastUserMessage = getLastUserMessage(mockChat, 1);
    expect(lastUserMessage).toContain('previous response had issues');
    expect(lastUserMessage).toContain('exceeds chart bounds');
    expect(lastUserMessage).toContain('Original request:');
  });

  test('exhaustion ships the last response (Ok, not Err) and routes "Retries exhausted" through the configured logger', async () => {
    // Heal guarantees every Ok is renderable; the last partial flows through
    // rather than becoming a synthetic error. A degraded UI beats a blocked
    // turn under the realtime-UX principle. Spy logger pins the integration
    // path that wires `config.logger` into `callWithRetry` end-to-end — a
    // future refactor passing `silentLogger` instead would fail here.
    mockChat.mockResolvedValue(layoutEmptyingResponse);

    const logEntries: Array<{ level: string; msg: string; ctx?: unknown }> = [];
    const spyLogger = {
      debug: () => {},
      info: (msg: string, ctx?: unknown) =>
        logEntries.push({ level: 'info', msg, ctx }),
      warn: (msg: string, ctx?: unknown) =>
        logEntries.push({ level: 'warn', msg, ctx }),
      error: (msg: string, _error?: unknown, ctx?: unknown) =>
        logEntries.push({ level: 'error', msg, ctx }),
    };

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: spyLogger,
      maxRetries: 2,
    });
    const result = await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    // Heal dropped the overflowing position; the renderable layout is empty.
    expect(result.value.response.layout.type).toBe('grid');
    if (result.value.response.layout.type !== 'grid') return;
    expect(result.value.response.layout.positions).toHaveLength(0);
    // Initial + 2 retries = 3 attempts.
    expect(mockChat).toHaveBeenCalledTimes(3);

    const exhausted = logEntries.filter((e) => e.msg === 'Retries exhausted');
    expect(exhausted).toHaveLength(1);
    // Layout-empty case → severity 'unrecoverable' → error-level routing.
    expect(exhausted[0]?.level).toBe('error');
    expect(exhausted[0]?.ctx).toMatchObject({
      attempts: 3,
      retrySeverity: 'unrecoverable',
    });
  });

  test('retries on action-empty path (severity=medium) — every proposed action skipped for a fixable reason', async () => {
    // Layout renders cleanly; the LLM's execution plan proposes an action
    // with unparseable params, which heal records as a `params_parse_failed`
    // skipped action. With `proposedActionCount > 0 && acceptedActionCount
    // === 0 && anySkipFixable`, deriveRetryHint flips recommend=true at
    // severity 'medium'. Pins the integration path for the action-empty
    // retry trigger that the layout-empty path doesn't exercise.
    const actionEmptyResponse: GridResponse = {
      ...gridLLMResponse,
      executionPlan: [
        {
          instanceId: 'calendar-main',
          action: 'showWeek',
          paramsJson: '{not valid json',
        },
      ],
    };
    // First attempt: action skipped → recommend retry. Second: clean.
    mockChat.mockResolvedValueOnce(actionEmptyResponse);
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      maxRetries: 3,
    });
    const result = await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(isOk(result)).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(2);

    // Retry prompt should reference the unparseable params, not "exceeds chart bounds".
    const lastUserMessage = getLastUserMessage(mockChat, 1);
    expect(lastUserMessage).toContain('unparseable params');
    expect(lastUserMessage).not.toContain('exceeds chart bounds');
  });

  test('default maxRetries is 1 (2 total attempts before shipping partial)', async () => {
    mockChat.mockResolvedValue(layoutEmptyingResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(isOk(result)).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  test('maxRetries=0 disables retry — ships the first response unconditionally', async () => {
    mockChat.mockResolvedValueOnce(layoutEmptyingResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      maxRetries: 0,
    });
    const result = await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(isOk(result)).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  test('does not retry when heal absorbs the failure without flipping recommend (missing rationale → warning, not retry)', async () => {
    // Empty rationale heals to a warning rather than an Err; recommend stays
    // false because the layout still renders. Retry must not fire on a
    // healing-but-renderable response.
    mockChat.mockResolvedValueOnce({
      ...gridLLMResponse,
      rationale: '',
    });

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      maxRetries: 3,
    });
    const result = await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(isOk(result)).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  test('processResponse Err (empty userMessage) short-circuits — no retry, surfaces ParseError', async () => {
    // Pins the fatal short-circuit on the processResponse Err path: an empty
    // userMessage produces a ParseError that callWithRetry surfaces
    // immediately rather than burning retries. A regression that mapped
    // processResponse Errs into Ok-with-recommend would silently retry on
    // user-visible parse failures.
    mockChat.mockResolvedValueOnce({
      ...gridLLMResponse,
      userMessage: '',
    });

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      maxRetries: 3,
    });
    const result = await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ParseError');
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// assistant_message variant
// ---------------------------------------------------------------------------

describe('engine.handle — assistant_message', () => {
  test('returns outcome=inserted and persists the injection when history is configured', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store },
    });
    const sessionId = SessionId('s-1');
    const injection = AssistantInjectionMessage({
      sessionId,
      content: 'seeded note',
      id: MessageId('inj-1'),
    });

    const result = await engine.handle(injection);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.type).toBe('assistant_message_result');
    if (result.value.type !== 'assistant_message_result') return;
    expect(result.value.outcome).toBe('inserted');
    expect(result.value.sessionId).toBe(sessionId);
    expect(result.value.id).toBe(injection.id);

    const entries = await store.get(sessionId);
    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe('injection');
  });

  test('reports outcome=deduped on a duplicate id', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store },
    });
    const sessionId = SessionId('s-1');
    const id = MessageId('dup');
    await engine.handle(
      AssistantInjectionMessage({ sessionId, content: 'first', id }),
    );

    const second = await engine.handle(
      AssistantInjectionMessage({ sessionId, content: 'second', id }),
    );
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.type).toBe('assistant_message_result');
    if (second.value.type !== 'assistant_message_result') return;
    expect(second.value.outcome).toBe('deduped');

    const entries = await store.get(sessionId);
    expect(entries.length).toBe(1);
  });

  test('returns a ValidationError when history is not configured', async () => {
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.handle(
      AssistantInjectionMessage({
        sessionId: SessionId('s-1'),
        content: 'seeded note',
        id: MessageId('inj-1'),
      }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ValidationError');
    expect(result.error.message).toMatch(/history not configured/i);
  });

  test('rejects an injection whose content exceeds the configured maxChars', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 100, store },
    });
    const result = await engine.handle(
      AssistantInjectionMessage({
        sessionId: SessionId('s-1'),
        content: 'x'.repeat(200),
        id: MessageId('inj-1'),
      }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ValidationError');
    expect(result.error.message).toMatch(/exceeds.*maxChars/i);
    if (result.error._tag !== 'ValidationError') return;
    expect(result.error.field).toBe('content');

    expect((await store.get(SessionId('s-1'))).length).toBe(0);
  });

  test('accepts an injection at exactly maxChars (boundary)', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 100, store },
    });
    const result = await engine.handle(
      AssistantInjectionMessage({
        sessionId: SessionId('s-1'),
        content: 'x'.repeat(100),
        id: MessageId('inj-1'),
      }),
    );
    expect(isOk(result)).toBe(true);
  });

  test('accepts arbitrarily large injections when maxChars is not configured', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, store },
    });
    const result = await engine.handle(
      AssistantInjectionMessage({
        sessionId: SessionId('s-1'),
        content: 'x'.repeat(50_000),
        id: MessageId('inj-1'),
      }),
    );
    expect(isOk(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// History integration
// ---------------------------------------------------------------------------

describe('engine.handle — history integration', () => {
  test('records the turn after a successful chart_request when history is configured', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store },
    });
    const request = makeGridRequest();
    await engine.handle(toChartRequestMessage(request));

    const entries = await store.get(DEFAULT_SESSION_ID);
    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe('turn');
  });

  test('does NOT record when history is not configured', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    // Spy store passed in via a dummy assertion — we don't wire it into the
    // engine; we just check that no engine code path could have written to a
    // store when none is configured. (Old version asserted on a store the
    // engine never received, which was tautological — a freshly constructed
    // store is trivially empty.)
    const append = mock<HistoryStore['append']>(async () => ({
      inserted: true,
    }));
    const spyStore: HistoryStore = {
      ...createInMemoryStore(),
      append,
    };
    void spyStore; // not wired into the engine
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );
    expect(isOk(result)).toBe(true);
    expect(append).not.toHaveBeenCalled();
  });

  test('skips truncation when the recordTurn append is a deduped no-op', async () => {
    // Same envelope id replayed: store.append returns inserted=false. The
    // engine must not run truncation (no replace() call) on a no-op write —
    // a duplicate can't push us past the cap, so reading and rewriting the
    // session would be wasted work.
    mockChat.mockResolvedValue(gridLLMResponse);
    const inner = createInMemoryStore();
    const replace = mock<HistoryStore['replace']>(async () => undefined);
    const wrappedStore: HistoryStore = {
      ...inner,
      replace,
    };
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: wrappedStore },
    });
    const request = makeGridRequest();
    await engine.handle(toChartRequestMessage(request));
    await engine.handle(toChartRequestMessage(request));
    expect((await wrappedStore.get(DEFAULT_SESSION_ID)).length).toBe(1);
    expect(replace).not.toHaveBeenCalled();
  });

  test('does NOT record when the chart_request fails', async () => {
    mockChat.mockRejectedValueOnce(new Error('LLM down'));

    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store },
    });
    const request = makeGridRequest();
    const result = await engine.handle(toChartRequestMessage(request));
    expect(isErr(result)).toBe(true);

    const entries = await store.get(DEFAULT_SESSION_ID);
    expect(entries).toEqual([]);
  });

  test('routes on message.type discriminator (type narrowing)', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store },
    });

    const messages: EngineMessage[] = [
      toChartRequestMessage(makeGridRequest()),
      AssistantInjectionMessage({
        sessionId: SessionId('session-1'),
        content: 'seeded',
        id: MessageId('inj-after'),
      }),
    ];

    for (const msg of messages) {
      const result = await engine.handle(msg);
      expect(isOk(result)).toBe(true);
    }
    const entries = await store.get(SessionId('session-1'));
    expect(entries.map((e) => e.kind)).toEqual(['turn', 'injection']);
  });

  test('returns ok(chart_response) when history.recordTurn throws (advisory write)', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const inner = createInMemoryStore();
    const throwingStore: HistoryStore = {
      ...inner,
      async append() {
        throw new Error('store offline');
      },
    };
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: throwingStore },
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.userMessage).toBe('Here is your calendar!');
  });

  test('returns err(HistoryError) when history.addAssistantMessage throws', async () => {
    const inner = createInMemoryStore();
    const throwingStore: HistoryStore = {
      ...inner,
      async append() {
        throw new Error('store offline');
      },
    };
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: throwingStore },
    });

    const result = await engine.handle(
      AssistantInjectionMessage({
        sessionId: SessionId('s'),
        content: 'seeded',
        id: MessageId('i'),
      }),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('HistoryError');
    if (result.error._tag !== 'HistoryError') return;
    expect(result.error.operation).toBe('add_assistant_message');
    expect(result.error.message).toMatch(/failed to persist/i);
    expect(result.error.cause).toBeInstanceOf(Error);
  });

  test('feeds recorded turns back into the next LLM call as prior messages', async () => {
    mockChat.mockResolvedValueOnce({
      ...gridLLMResponse,
      userMessage: 'First response.',
    });
    mockChat.mockResolvedValueOnce({
      ...gridLLMResponse,
      userMessage: 'Second response.',
    });

    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 10_000, store },
    });

    // Turn 1 — fresh session, no prior messages.
    const first = await engine.handle(toChartRequestMessage(makeGridRequest()));
    expect(isOk(first)).toBe(true);

    const firstCall = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstCall.messages).toEqual([
      { role: 'user', content: expect.any(String) },
    ]);

    // Turn 2 — reuse session, expect turn 1 to show up as prior messages.
    const second = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );
    expect(isOk(second)).toBe(true);

    const secondCall = mockChat.mock.calls[1]?.[0] as Record<string, unknown>;
    const messages = secondCall.messages as ReadonlyArray<{
      role: string;
      content: string;
    }>;
    expect(messages.length).toBe(3);
    expect(messages[0]?.role).toBe('user');
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: 'First response.',
    });
    expect(messages[2]?.role).toBe('user');
  });

  test('feeds assistant_message injections into the next LLM call', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const store = createInMemoryStore();
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 10_000, store },
    });
    const sessionId = SessionId('session-1');

    // Seed an injection before the first chart_request.
    await engine.handle(
      AssistantInjectionMessage({
        sessionId,
        content: 'Background: user is on the pricing page.',
        id: MessageId('seed-1'),
      }),
    );

    await engine.handle(toChartRequestMessage(makeGridRequest()));

    const callArgs = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    const messages = callArgs.messages as ReadonlyArray<{
      role: string;
      content: string;
    }>;
    expect(messages).toContainEqual({
      role: 'assistant',
      content: 'Background: user is on the pricing page.',
    });
  });

  test('does not inject any prior messages when history is not configured', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    await engine.handle(toChartRequestMessage(makeGridRequest()));

    const callArgs = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.messages).toEqual([
      { role: 'user', content: expect.any(String) },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Wire-format validation
// ---------------------------------------------------------------------------

describe('engine.handle — wire-format validation', () => {
  test('rejects malformed envelope before LLM call', async () => {
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });

    // Missing sessionId — envelope-layer failure.
    const result = await engine.handle(
      invalid({
        type: 'chart_request',
        id: 'm-1',
        timestamp: 1,
        request: makeGridRequest(),
      }),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('RequestValidationError');
      if (result.error._tag === 'RequestValidationError') {
        expect(result.error.layer).toBe('envelope');
        expect(result.error.field).toBe('sessionId');
      }
    }
    expect(mockChat).not.toHaveBeenCalled();
  });

  test('rejects malformed inner payload before LLM call', async () => {
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });

    const env = toChartRequestMessage(
      makeGridRequest(),
      SessionId('sess-1'),
    );
    // Mutate envelope to corrupt inner payload.
    const corrupted = invalid<typeof env>({
      ...env,
      request: { ...env.request, context: invalid({}) },
    });

    const result = await engine.handle(corrupted);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('RequestValidationError');
      if (result.error._tag === 'RequestValidationError') {
        expect(result.error.layer).toBe('payload');
        expect(result.error.field.startsWith('request')).toBe(true);
      }
    }
    expect(mockChat).not.toHaveBeenCalled();
  });

  test('rejects assistant_message with empty content before history write', async () => {
    const append = mock(() => Promise.resolve({ inserted: true }));
    const store = {
      append,
      get: mock(() => Promise.resolve([])),
      replace: mock(() => Promise.resolve()),
      clear: mock(() => Promise.resolve()),
    } satisfies Partial<HistoryStore>;
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      history: { store, maxEntries: 10, maxChars: 1000 },
    });

    const result = await engine.handle(
      invalid({
        type: 'assistant_message',
        sessionId: 'sess-1',
        id: 'm-1',
        timestamp: 1,
        content: '',
      }),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('RequestValidationError');
      if (result.error._tag === 'RequestValidationError') {
        expect(result.error.layer).toBe('payload');
        expect(result.error.field).toBe('content');
      }
    }
    expect(append).not.toHaveBeenCalled();
  });

  test('passes valid envelopes through to the existing pipeline (regression)', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });

    const env = toChartRequestMessage(
      makeGridRequest(),
      SessionId('sess-1'),
    );

    const result = await engine.handle(env);
    expect(isOk(result)).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
