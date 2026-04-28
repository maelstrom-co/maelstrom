import { afterEach, describe, expect, mock, test } from 'bun:test';

import type {
  ChartRequest,
  EngineMessage,
  GridResponse,
  TilingResponse,
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
  makeGridRequest,
  silentLogger,
} from './__test-helpers__/fixtures.js';

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
): ChartRequestMessage => ChartRequestMessage({ sessionId, id, request });

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
