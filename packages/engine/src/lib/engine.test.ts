import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ChartRequest, GridResponse, TilingResponse } from '@maelstrom-co/protocol';
import { InstanceId, isErr, isOk, MessageId, SessionId } from '@maelstrom-co/protocol';
import type { EngineConfig } from './config.js';
import { createEngine } from './engine.js';
import {
  dummyAdapter,
  makeGridRequest,
  silentLogger,
} from './__test-helpers__/fixtures.js';

// ---------------------------------------------------------------------------
// Mock TanStack AI chat()
// ---------------------------------------------------------------------------

// We mock at the module level since chat() is imported from @tanstack/ai
// and the adapter interface is complex. This tests our pipeline logic.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
  ])(
    'throws synchronously when config is invalid ($name)',
    ({ config, pattern }) => {
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
    },
  );

  test('returns an Engine for a valid minimal config', () => {
    const engine = createEngine({ adapter: dummyAdapter });
    expect(engine).toBeDefined();
    expect(typeof engine.process).toBe('function');
  });

  test('process returns a successful Result with MaelstromResponse', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.process(makeGridRequest());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.type).toBe('maelstrom_response');
    expect(result.value.requestId).toBe(MessageId('req-1'));
    expect(result.value.userMessage).toBe('Here is your calendar!');
    expect(result.value.layout.type).toBe('grid');
  });

  test('chat() is called with correct options', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    await engine.process(makeGridRequest());

    expect(mockChat).toHaveBeenCalledTimes(1);
    const callArgs = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).toHaveProperty('adapter', dummyAdapter);
    expect(callArgs).toHaveProperty('stream', false);
    expect(callArgs).toHaveProperty('outputSchema');
    expect(callArgs).toHaveProperty('systemPrompts');
    expect(callArgs).toHaveProperty('messages');
  });

  test('process returns ProviderError when chat() throws', async () => {
    mockChat.mockRejectedValueOnce(new Error('LLM service unavailable'));

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.process(makeGridRequest());

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;

    expect(result.error._tag).toBe('ProviderError');
    expect(result.error.message).toBe('LLM service unavailable');
  });

  test('process returns ProviderError when chat() throws a non-Error value', async () => {
    mockChat.mockRejectedValueOnce('rate limited');

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.process(makeGridRequest());

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;

    expect(result.error._tag).toBe('ProviderError');
    expect(result.error.message).toBe('rate limited');
  });

  test('passes abortController to chat()', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    await engine.process(makeGridRequest());

    const callArgs = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.abortController).toBeInstanceOf(AbortController);
  });

  test('process returns CancellationError when signal is already aborted', async () => {
    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });

    const controller = new AbortController();
    controller.abort('user cancel');

    const result = await engine.process(makeGridRequest(), controller.signal);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;

    expect(result.error._tag).toBe('CancellationError');
    expect(mockChat).not.toHaveBeenCalled();
  });

  test('process returns CancellationError when signal aborts during chat()', async () => {
    const controller = new AbortController();

    mockChat.mockImplementationOnce(() => {
      controller.abort('timed out');
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
    });
    const result = await engine.process(makeGridRequest(), controller.signal);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;

    expect(result.error._tag).toBe('CancellationError');
  });

  test('uses consoleLogger when no logger provided', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({ adapter: dummyAdapter });
    const result = await engine.process(makeGridRequest());
    expect(isOk(result)).toBe(true);
  });

  test('applies prompt options from config', async () => {
    mockChat.mockResolvedValueOnce(gridLLMResponse);

    const engine = createEngine({
      adapter: dummyAdapter,
      logger: silentLogger,
      prompt: {
        system: { identity: 'You are a custom assistant.' },
      },
    });

    const result = await engine.process(makeGridRequest());
    expect(isOk(result)).toBe(true);

    // Verify the system prompt was customized
    const callArgs = mockChat.mock.calls[0]?.[0] as Record<string, unknown>;
    const systemPrompts = callArgs.systemPrompts as string[];
    expect(systemPrompts[0]).toContain('You are a custom assistant.');
    expect(systemPrompts[0]).not.toContain('You are Maelstrom');
  });

  test('parses execution plan from LLM response', async () => {
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
    const result = await engine.process({
      ...makeGridRequest(),
      instances: [
        { instanceId: InstanceId('calendar-main'), vesselId: 'calendar', variant: 'month' },
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
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.executionPlan).toHaveLength(1);
    expect(result.value.executionPlan[0]?.params).toEqual({
      weekStart: '2026-04-06',
    });
  });

  test('processes tiling mode request end-to-end', async () => {
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
      id: MessageId('req-tiling'),
      context: {
        updateReasons: [
          { type: 'user_intent', intent: 'Show tasks next to calendar' },
        ],
        chartDimensions: { columns: 12, rows: 8 },
        timestamp: Date.now(),
        sessionId: SessionId('session-tiling'),
        layoutMode: 'tiling',
      },
      instances: [
        { instanceId: InstanceId('calendar-main'), vesselId: 'calendar', variant: 'month' },
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
    const result = await engine.process(tilingRequest);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.layout.type).toBe('tiling');
    expect(result.value.requestId).toBe(MessageId('req-tiling'));
  });
});
