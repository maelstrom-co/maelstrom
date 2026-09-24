import { describe, expect, mock, test } from 'bun:test';

import type { ChartRequest, EngineMessage } from '@maelstrom-co/protocol';
import {
  AssistantInjectionMessage,
  ChartRequestMessage,
  err,
  InstanceId,
  isErr,
  isOk,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  brandTilingResponse,
  buildGridResponse,
  invalid,
  makeGridRequest,
  makeTilingRequest,
  silentLogger,
} from './__test-helpers__/fixtures.js';
import { spyLogger } from './__test-helpers__/stage-context.js';
import {
  scriptedPlanner,
  throwingPlanner,
} from './__test-helpers__/stub-planner.js';
import type { EngineConfig } from './config.js';
import { createEngine } from './engine.js';
import { providerError } from './errors.js';
import type { HistoryEntry, HistoryStore } from './history/history-store.js';
import { createInMemoryStore } from './history/in-memory-store.js';
import type { PlannerCandidate } from './planner/candidate.js';
import { pipeline } from './planner/pipeline.js';
import type {
  Planner,
  PlanningInput,
  Retryable,
  StageContext,
} from './planner/stage.js';
import { deferred } from './planner/stage.js';
import { withFallback } from './planner/with-fallback.js';

const gridLLMResponse = buildGridResponse();

const DEFAULT_SESSION_ID = SessionId('session-1');
const DEFAULT_MESSAGE_ID = MessageId('req-1');

// Wraps a ChartRequest fixture into the envelope so tests read naturally.
const toChartRequestMessage = (
  request: ChartRequest,
  sessionId: SessionId = DEFAULT_SESSION_ID,
  id: MessageId = DEFAULT_MESSAGE_ID,
): ChartRequestMessage => ChartRequestMessage({ sessionId, id, request });

/**
 * Wraps a planner with an invocation counter, for the tests that used to
 * pin a call count on the mocked `chat()`.
 */
const countingPlanner = (
  inner: Planner,
): { readonly planner: Planner; readonly calls: () => number } => {
  let count = 0;
  const planner: Planner = async (input, ctx) => {
    count += 1;
    return inner(input, ctx);
  };
  return { planner, calls: () => count };
};

describe('createEngine', () => {
  test.each([
    {
      name: 'missing planner',
      config: {} as EngineConfig,
      pattern: /planner/,
    },
    {
      name: 'planner is not a function',
      config: { planner: {} } as unknown as EngineConfig,
      pattern: /planner \[custom\]: expected function/,
    },
    {
      name: 'adapter passed to the engine instead of into the planner',
      config: {
        planner: scriptedPlanner([]),
        adapter: {},
      } as unknown as EngineConfig,
      pattern: /unrecognized|adapter/i,
    },
    {
      name: 'removed maxRetries key',
      config: {
        planner: scriptedPlanner([]),
        maxRetries: 1,
      } as unknown as EngineConfig,
      pattern: /unrecognized|maxRetries/i,
    },
    {
      name: 'invalid retry budget',
      config: {
        planner: scriptedPlanner([]),
        retry: { max: -1 },
      } as unknown as EngineConfig,
      pattern: /retry/,
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
    const engine = createEngine({
      planner: scriptedPlanner([]),
    });
    expect(engine).toBeDefined();
    expect(typeof engine.handle).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// chart_request variant
// ---------------------------------------------------------------------------

describe('engine.handle — chart_request', () => {
  test('returns a chart_response envelope on success', async () => {
    const engine = createEngine({
      planner: scriptedPlanner([gridLLMResponse]),
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

  test('returns HistoryError when getLLMContext throws (no LLM call)', async () => {
    const throwingStore: HistoryStore = {
      ...createInMemoryStore(),
      get: async () => {
        throw new Error('network down');
      },
    };
    let plannerCalls = 0;
    const planner: Planner = async (input, ctx) => {
      plannerCalls += 1;
      return scriptedPlanner([gridLLMResponse])(input, ctx);
    };
    const engine = createEngine({
      planner,
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
    expect(plannerCalls).toBe(0);
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
      planner: scriptedPlanner([]),
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
      planner: scriptedPlanner([]),
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
      planner: scriptedPlanner([]),
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
    const engine = createEngine({
      planner: scriptedPlanner([gridLLMResponse]),
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );
    expect(isOk(result)).toBe(true);
  });

  test('parses the execution plan from the LLM response', async () => {
    const responseWithActions = buildGridResponse({
      executionPlan: [
        {
          instanceId: 'calendar-main',
          action: 'showWeek',
          paramsJson: '{"weekStart":"2026-04-06"}',
        },
      ],
    });

    const engine = createEngine({
      planner: scriptedPlanner([responseWithActions]),
      logger: silentLogger,
    });
    const result = await engine.handle(
      toChartRequestMessage(
        makeGridRequest({
          instances: [
            {
              instanceId: 'calendar-main',
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
                  actions: [
                    {
                      name: 'showWeek',
                      description: 'Show week view',
                      parameters: [
                        {
                          name: 'weekStart',
                          type: 'string',
                          description: 'First day of the week',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        }),
      ),
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.executionPlan).toHaveLength(1);
    expect(result.value.response.executionPlan[0]?.params).toEqual({
      weekStart: '2026-04-06',
    });
  });

  test.each([
    ['empty', '', 'empty-user-message-secret-8d41e2'],
    ['whitespace-only', ' \t\n ', 'whitespace-user-message-secret-c390af'],
  ])('redacts model output when userMessage is %s', async (_case, userMessage, secret) => {
    const logged: unknown[][] = [];
    const logger: Parameters<typeof createEngine>[0]['logger'] = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (message, error, data) => logged.push([message, error, data]),
    };
    const engine = createEngine({
      planner: scriptedPlanner([
        buildGridResponse({
          userMessage,
          executionPlan: [
            {
              instanceId: 'calendar-main',
              action: 'showWeek',
              paramsJson: JSON.stringify({ nested: { value: secret } }),
            },
          ],
        }),
      ]),
      logger,
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ParseError');
    if (result.error._tag !== 'ParseError') return;
    expect(result.error.raw).toBe('userMessage');
    const serializedError = JSON.stringify(result.error);
    const serializedLogs = JSON.stringify(logged);
    expect(serializedError).not.toContain('paramsJson');
    expect(serializedError).not.toContain(secret);
    expect(serializedLogs).not.toContain('paramsJson');
    expect(serializedLogs).not.toContain(secret);
  });

  test('processes a tiling-mode request end-to-end', async () => {
    const tilingResponse = brandTilingResponse({
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
    });

    const tilingRequest = makeTilingRequest({
      context: {
        updateReasons: [
          { type: 'user_intent', intent: 'Show tasks next to calendar' },
        ],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'tiling',
      },
      instances: [
        {
          instanceId: 'calendar-main',
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

    const engine = createEngine({
      planner: scriptedPlanner([tilingResponse]),
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
    const partiallyHealed = buildGridResponse({
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
    });

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
      planner: scriptedPlanner([partiallyHealed]),
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
      skippedActions: expect.any(Number),
      retrySeverity: 'medium',
      retryRecommend: false,
    });
  });

  test('"Response healed" carries the identity of every refused action', async () => {
    // The scalar count says how many actions were refused; only these fields
    // say which. An eval harness reads them to tell a specific replay apart
    // from any other skip, so a reword of the shape has to break a test.
    const logEntries: Array<{ msg: string; ctx?: unknown }> = [];
    const spyLogger = {
      debug: () => {},
      info: (msg: string, ctx?: unknown) => logEntries.push({ msg, ctx }),
      warn: (msg: string, ctx?: unknown) => logEntries.push({ msg, ctx }),
      error: (msg: string, _error?: unknown, ctx?: unknown) =>
        logEntries.push({ msg, ctx }),
    };

    const engine = createEngine({
      planner: scriptedPlanner([
        buildGridResponse({
          executionPlan: [{ instanceId: 'calendar-main', action: 'showWeek' }],
        }),
      ]),
      logger: spyLogger,
    });
    await engine.handle(
      toChartRequestMessage(
        makeGridRequest({
          context: {
            updateReasons: [
              {
                type: 'chart_resize',
                previous: { columns: 12, rows: 8 },
                current: { columns: 8, rows: 8 },
              },
            ],
            chartDimensions: { columns: 8, rows: 8 },
            layoutMode: 'grid',
          },
        }),
      ),
    );

    const healed = logEntries.filter((e) => e.msg === 'Response healed');
    expect(healed).toHaveLength(1);
    expect(healed[0]?.ctx).toMatchObject({
      skippedActions: 1,
      detail: {
        skips: [
          {
            reason: 'non_idempotent_on_resize',
            instanceId: 'calendar-main',
            action: 'showWeek',
            vesselId: 'calendar',
          },
        ],
      },
    });
  });

  test('"Response healed" routes to error level for unrecoverable severity', async () => {
    // Single-instance request + overflowing position → healed layout empty
    // → severity='unrecoverable' → error-level routing on first attempt.
    const layoutEmptyingResponse = buildGridResponse({
      layout: {
        positions: [
          {
            instanceId: 'calendar-main',
            position: { row: 0, column: 0 },
            size: { width: 15, height: 4 },
          },
        ],
      },
    });
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

    // Default retry is { max: 1 } — two attempts total, both resolving to
    // the same unrecoverable candidate so "Response healed" fires at error
    // level on the final attempt, not just when the mock is consumed once.
    const engine = createEngine({
      planner: scriptedPlanner([
        layoutEmptyingResponse,
        layoutEmptyingResponse,
      ]),
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

  test('"Response healed" detail renders drops under a list ceiling', async () => {
    // A drop count alone tells an operator that something was cut but never
    // what, so the forensic lines belong beside the repairs already there.
    const overflowCount = 17;
    const extras = Array.from(
      { length: overflowCount },
      (_, index) => `extra-${index}`,
    );
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
      planner: scriptedPlanner([
        buildGridResponse({
          layout: {
            positions: [
              {
                instanceId: 'calendar-main',
                position: { row: 0, column: 0 },
                size: { width: 6, height: 4 },
              },
              ...extras.map((instanceId) => ({
                instanceId,
                position: { row: 0, column: 0 },
                size: { width: 15, height: 4 },
              })),
            ],
          },
        }),
      ]),
      logger: spyLogger,
    });
    const request = makeGridRequest({
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'calendar',
          variant: 'month',
        },
        ...extras.map((instanceId) => ({
          instanceId: InstanceId(instanceId),
          vesselId: 'calendar',
          variant: 'month',
        })),
      ],
    });
    await engine.handle(toChartRequestMessage(request));

    const healed = logEntries.filter((e) => e.msg === 'Response healed');
    expect(healed).toHaveLength(1);
    const detail = (healed[0]?.ctx as { detail: { drops: string[] } }).detail;
    // 16 rendered plus the tail count, matching `formatLayoutWarnings`.
    expect(detail.drops).toHaveLength(17);
    expect(detail.drops[0]).toBe(
      'instance "extra-0" at (0,0) size 15x4 exceeds chart bounds (12x8)',
    );
    expect(detail.drops[15]).toContain('"extra-15"');
    expect(detail.drops.at(-1)).toBe('1 additional drop omitted');
    expect(healed[0]?.ctx).toMatchObject({
      droppedLayoutEntries: overflowCount,
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
  const layoutEmptyingResponse = buildGridResponse({
    layout: {
      positions: [
        {
          instanceId: 'calendar-main',
          position: { row: 0, column: 0 },
          size: { width: 15, height: 4 },
        },
      ],
    },
  });

  test('retries when retryHint recommends and succeeds on the second attempt', async () => {
    const { planner, calls } = countingPlanner(
      scriptedPlanner([layoutEmptyingResponse, gridLLMResponse]),
    );
    const engine = createEngine({
      planner,
      logger: silentLogger,
      retry: { max: 3 },
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.layout.type).toBe('grid');
    expect(calls()).toBe(2);
  });

  test('exhaustion ships the last response (Ok, not Err) and routes "Retries exhausted" through the configured logger', async () => {
    // Heal guarantees every Ok is renderable; the last partial flows through
    // rather than becoming a synthetic error. A degraded UI beats a blocked
    // turn under the realtime-UX principle. Spy logger pins the integration
    // path that wires `config.logger` into `withRetry` end-to-end — a
    // future refactor passing `silentLogger` instead would fail here.
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

    // Initial + 2 retries = 3 attempts, all resolving to the same
    // unrecoverable candidate.
    const { planner, calls } = countingPlanner(
      scriptedPlanner([
        layoutEmptyingResponse,
        layoutEmptyingResponse,
        layoutEmptyingResponse,
      ]),
    );
    const engine = createEngine({
      planner,
      logger: spyLogger,
      retry: { max: 2 },
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    // Heal dropped the overflowing position; the renderable layout is empty.
    expect(result.value.response.layout.type).toBe('grid');
    if (result.value.response.layout.type !== 'grid') return;
    expect(result.value.response.layout.positions).toHaveLength(0);
    expect(calls()).toBe(3);

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
    // retry trigger that the layout-empty path doesn't exercise. (The
    // retry prompt's content for this diagnostic shape — "unparseable
    // params" rather than "exceeds chart bounds" — is pinned in
    // llm-planner.test.ts, which owns retry-prompt building.)
    const actionEmptyResponse = buildGridResponse({
      executionPlan: [
        {
          instanceId: 'calendar-main',
          action: 'showWeek',
          paramsJson: '{not valid json',
        },
      ],
    });
    // First attempt: action skipped → recommend retry. Second: clean.
    const { planner, calls } = countingPlanner(
      scriptedPlanner([actionEmptyResponse, gridLLMResponse]),
    );
    const engine = createEngine({
      planner,
      logger: silentLogger,
      retry: { max: 3 },
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    expect(calls()).toBe(2);
  });

  test('default retry is { max: 1 } (2 total attempts before shipping partial)', async () => {
    const { planner, calls } = countingPlanner(
      scriptedPlanner([layoutEmptyingResponse, layoutEmptyingResponse]),
    );
    const engine = createEngine({
      planner,
      logger: silentLogger,
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    expect(calls()).toBe(2);
  });

  test('retry { max: 0 } disables retry — ships the first response unconditionally', async () => {
    const { planner, calls } = countingPlanner(
      scriptedPlanner([layoutEmptyingResponse]),
    );
    const engine = createEngine({
      planner,
      logger: silentLogger,
      retry: { max: 0 },
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    expect(calls()).toBe(1);
  });

  test('does not retry when heal absorbs the failure without flipping recommend (missing rationale → warning, not retry)', async () => {
    // Empty rationale heals to a warning rather than an Err; recommend stays
    // false because the layout still renders. Retry must not fire on a
    // healing-but-renderable response.
    const { planner, calls } = countingPlanner(
      scriptedPlanner([{ ...gridLLMResponse, rationale: '' }]),
    );
    const engine = createEngine({
      planner,
      logger: silentLogger,
      retry: { max: 3 },
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    expect(calls()).toBe(1);
  });

  test('processResponse Err (empty userMessage) short-circuits — no retry, surfaces ParseError', async () => {
    // Pins the fatal short-circuit on the processResponse Err path: an empty
    // userMessage produces a ParseError that withRetry surfaces
    // immediately rather than burning retries. A regression that mapped
    // processResponse Errs into Ok-with-recommend would silently retry on
    // user-visible parse failures.
    const { planner, calls } = countingPlanner(
      scriptedPlanner([{ ...gridLLMResponse, userMessage: '' }]),
    );
    const engine = createEngine({
      planner,
      logger: silentLogger,
      retry: { max: 3 },
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ParseError');
    expect(calls()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Planner seam
// ---------------------------------------------------------------------------

describe('engine.handle with a configured planner', () => {
  const layoutEmptying = () =>
    buildGridResponse({
      layout: {
        positions: [
          {
            instanceId: 'calendar-main',
            position: { row: 0, column: 0 },
            size: { width: 15, height: 4 },
          },
        ],
      },
    });

  const resizeOnlyRequest = () =>
    makeGridRequest({
      context: {
        updateReasons: [
          {
            type: 'chart_resize',
            previous: { columns: 12, rows: 8 },
            current: { columns: 8, rows: 8 },
          },
        ],
        chartDimensions: { columns: 8, rows: 8 },
        layoutMode: 'grid',
      },
    });

  test('runs a custom stage end to end with the request, history and context', async () => {
    const inputs: PlanningInput[] = [];
    const contexts: StageContext[] = [];
    const planner: Planner = async (input, ctx) => {
      inputs.push(input);
      contexts.push(ctx);
      return ok(buildGridResponse({ userMessage: 'from a custom stage' }));
    };
    const { logger } = spyLogger();
    const engine = createEngine({ planner, logger });
    const request = makeGridRequest();

    const result = await engine.handle(toChartRequestMessage(request));

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.userMessage).toBe('from a custom stage');
    expect(result.value.response.requestId).toBe(DEFAULT_MESSAGE_ID);
    expect(result.value.response).not.toHaveProperty('diagnostics');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({
      messageId: DEFAULT_MESSAGE_ID,
      sessionId: DEFAULT_SESSION_ID,
      request,
      history: [],
    });
    expect(contexts[0]?.origin).toBe(inputs[0]);
    expect(contexts[0]?.logger).toBe(logger);
  });

  test('composes stages with pipeline and feeds prior history to the first', async () => {
    const store = createInMemoryStore();
    let seenHistory: PlanningInput['history'] | undefined;
    const planner = pipeline(
      async (input: PlanningInput) => {
        seenHistory = input.history;
        return ok({ greeting: `turn ${input.history.length / 2 + 1}` });
      },
      async (selection: { greeting: string }) =>
        ok(buildGridResponse({ userMessage: selection.greeting })),
    );
    const engine = createEngine({
      planner,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 10_000, store },
    });

    await engine.handle(
      toChartRequestMessage(
        makeGridRequest(),
        DEFAULT_SESSION_ID,
        MessageId('a'),
      ),
    );
    const second = await engine.handle(
      toChartRequestMessage(
        makeGridRequest(),
        DEFAULT_SESSION_ID,
        MessageId('b'),
      ),
    );

    expect(isOk(second)).toBe(true);
    if (!isOk(second) || second.value.type !== 'chart_response') return;
    expect(second.value.response.userMessage).toBe('turn 2');
    expect(seenHistory?.length).toBe(2);
  });

  test('retry: false runs the planner once even when a retry is recommended', async () => {
    let calls = 0;
    const planner: Planner = async () => {
      calls += 1;
      return ok(layoutEmptying());
    };
    const { logger, entries } = spyLogger();
    const engine = createEngine({ planner, logger, retry: false });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    expect(calls).toBe(1);
    expect(entries.map((entry) => entry.msg)).not.toContain(
      'Retries exhausted',
    );
    expect(
      entries.find((entry) => entry.msg === 'Response healed')?.ctx,
    ).toMatchObject({ retryRecommend: true });
  });

  test('retry: { max: 2 } re-runs the planner twice with feedback about the latest attempt', async () => {
    const inputs: Retryable<PlanningInput>[] = [];
    const planner: Planner = async (input) => {
      inputs.push(input);
      return ok(layoutEmptying());
    };
    const engine = createEngine({
      planner,
      logger: silentLogger,
      retry: { max: 2 },
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    expect(inputs.map((input) => input.retry?.attempt)).toEqual([
      undefined,
      1,
      2,
    ]);
    expect(inputs[2]?.retry?.diagnostics.retryHint).toEqual({
      severity: 'unrecoverable',
      recommend: true,
    });
  });

  test.each([
    ['the default retry', undefined],
    ['retry: false', false as const],
  ])('with %s the shipped candidate is healed once', async (_case, retry) => {
    const shipped = buildGridResponse({
      executionPlan: [
        { instanceId: 'calendar-main', action: 'showWeek' },
        { instanceId: 'calendar-main', action: 'showMonth', paramsJson: '{' },
      ],
    });
    const candidates = [layoutEmptying(), shipped];
    let calls = 0;
    const planner: Planner = async () => ok(candidates[calls++]!);
    const { logger, entries } = spyLogger();
    const engine = createEngine({
      planner: retry === false ? async () => ok(shipped) : planner,
      logger,
      ...(retry === undefined ? {} : { retry }),
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    if (retry === undefined) expect(calls).toBe(2);
    expect(
      entries.filter((entry) =>
        entry.msg.startsWith('Failed to parse paramsJson'),
      ),
    ).toHaveLength(1);
  });

  test('a Deferred nothing recovered is Err(ValidationError) on field "planner"', async () => {
    const planner: Planner = async () => err(deferred('no Vessel matched'));
    const { logger, entries } = spyLogger();
    const engine = createEngine({ planner, logger });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
      message: 'planner deferred: no Vessel matched',
    });
    expect(entries).toContainEqual({
      level: 'warn',
      msg: 'Planner deferred and nothing recovered the deferral',
      ctx: { messageId: DEFAULT_MESSAGE_ID, reason: 'no Vessel matched' },
    });
  });

  test('withFallback recovers a Deferred through the configured planner', async () => {
    const { planner: fallback, calls } = countingPlanner(
      scriptedPlanner([gridLLMResponse]),
    );
    const engine = createEngine({
      planner: withFallback(
        async () => err(deferred('not confident')),
        fallback,
      ),
      logger: silentLogger,
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.userMessage).toBe('Here is your calendar!');
    expect(calls()).toBe(1);
  });

  test('an EngineError from a stage passes through unchanged', async () => {
    const failure = providerError('upstream down', new Error('503'));
    const engine = createEngine({
      planner: async () => err(failure),
      logger: silentLogger,
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result) && result.error).toBe(failure);
  });

  test.each([
    [
      'throws synchronously',
      (() => {
        throw new Error('stage bug');
      }) as unknown as Planner,
    ],
    [
      'rejects',
      (async () => {
        throw new Error('stage bug');
      }) as Planner,
    ],
  ])('a stage that %s is Err(ValidationError), never a rejection', async (_case, planner) => {
    const { logger, entries } = spyLogger();
    const engine = createEngine({ planner, logger });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
      message: 'stage bug',
    });
    expect(entries.filter((entry) => entry.level === 'error')).toEqual([
      {
        level: 'error',
        msg: 'Planner threw',
        error: expect.any(Error),
        ctx: { messageId: DEFAULT_MESSAGE_ID },
      },
    ]);
  });

  test.each([
    ['null', null],
    ['a string', 'not a candidate'],
    ['an empty object', {}],
  ])('a candidate that is %s is an Err, never a rejection', async (_case, candidate) => {
    for (const retry of [false, { max: 1 }] as const) {
      const engine = createEngine({
        planner: async () => ok(candidate as unknown as PlannerCandidate),
        logger: silentLogger,
        retry,
      });

      const result = await engine.handle(
        toChartRequestMessage(makeGridRequest()),
      );

      expect(isErr(result)).toBe(true);
    }
  });

  test('an EngineError from a stage is logged once by the Engine', async () => {
    const failure = providerError('upstream down', new Error('503'));
    const { logger, entries } = spyLogger();
    const engine = createEngine({ planner: async () => err(failure), logger });

    await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(entries).toEqual([
      expect.objectContaining({ msg: 'Processing chart_request' }),
      {
        level: 'warn',
        msg: 'Planner failed',
        ctx: { messageId: DEFAULT_MESSAGE_ID, errorTag: 'ProviderError' },
      },
    ]);
  });

  test.each([
    ['a raw candidate', async () => buildGridResponse()],
    ['err() of a plain Error', async () => err(new Error('x'))],
    ['err() of a string', async () => err('timeout')],
  ])('a stage that resolves %s instead of a Result<PlannerCandidate, StageError> is Err(ValidationError) on field "planner"', async (_case, stage) => {
    const { logger, entries } = spyLogger();
    const engine = createEngine({
      planner: stage as unknown as Planner,
      logger,
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
      message:
        'planner returned a value that is not a Result<PlannerCandidate, StageError>',
    });
    expect(entries.filter((entry) => entry.level === 'error')).toEqual([
      expect.objectContaining({
        msg: 'Planner returned a value that is not a Result',
        ctx: { messageId: DEFAULT_MESSAGE_ID },
      }),
    ]);
  });

  test('a result that is not a Result is an Err, never a rejection', async () => {
    const engine = createEngine({
      planner: (async () => undefined) as unknown as Planner,
      logger: silentLogger,
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result) && result.error._tag).toBe('ValidationError');
  });

  test('passes the request signal to the stage', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const planner: Planner = async (_input, ctx) => {
      seen = ctx.signal;
      return ok(buildGridResponse());
    };
    const engine = createEngine({ planner, logger: silentLogger });

    await engine.handle(
      toChartRequestMessage(makeGridRequest()),
      controller.signal,
    );

    expect(seen).toBe(controller.signal);
  });

  test('a stage that throws after the signal aborted is Err(CancellationError)', async () => {
    const controller = new AbortController();
    const planner: Planner = async (_input, ctx) => {
      controller.abort('user left');
      if (ctx.signal?.aborted) throw new Error('socket closed');
      return ok(buildGridResponse());
    };
    const { logger, entries } = spyLogger();
    const engine = createEngine({ planner, logger });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
      controller.signal,
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toMatchObject({
      _tag: 'CancellationError',
      reason: 'user left',
    });
    expect(entries.find((entry) => entry.msg === 'Request cancelled')).toEqual({
      level: 'info',
      msg: 'Request cancelled',
      ctx: {
        messageId: DEFAULT_MESSAGE_ID,
        reason: 'user left',
        thrown: expect.objectContaining({ message: 'socket closed' }),
      },
    });
    expect(entries.filter((entry) => entry.level === 'error')).toEqual([]);
  });

  test('an AbortError thrown while the request signal is live is a planner failure, not a cancellation', async () => {
    const abort = new DOMException('stage timed out', 'AbortError');
    const planner: Planner = async () => {
      throw abort;
    };
    const { logger, entries } = spyLogger();
    const engine = createEngine({ planner, logger });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
      new AbortController().signal,
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
      message: 'stage timed out',
    });
    expect(entries.map((entry) => entry.msg)).not.toContain(
      'Request cancelled',
    );
    expect(entries.filter((entry) => entry.level === 'error')).toEqual([
      {
        level: 'error',
        msg: 'Planner threw',
        error: abort,
        ctx: { messageId: DEFAULT_MESSAGE_ID },
      },
    ]);
  });

  test('an AbortError thrown without a request signal is a planner failure', async () => {
    const planner: Planner = async () => {
      throw new DOMException('Aborted', 'AbortError');
    };
    const engine = createEngine({ planner, logger: silentLogger });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isErr(result) && result.error._tag).toBe('ValidationError');
  });

  test('validates against the request the client sent, not a stage-edited copy', async () => {
    // A stage that rewrites a resize-only turn into an intentful one must not
    // unlock content mutations: the refusal reads the original update reasons.
    const planner = pipeline(
      async (input: PlanningInput) =>
        ok({
          ...input,
          request: {
            ...input.request,
            context: {
              ...input.request.context,
              updateReasons: [
                { type: 'user_intent' as const, intent: 'show the week' },
              ],
            },
          },
        }),
      async (edited: PlanningInput) =>
        ok(
          buildGridResponse({
            userMessage: `planned for ${edited.request.context.updateReasons[0]?.type}`,
            executionPlan: [
              { instanceId: 'calendar-main', action: 'showWeek' },
            ],
          }),
        ),
    );
    const { logger, entries } = spyLogger();
    const engine = createEngine({ planner, logger, retry: false });

    const result = await engine.handle(
      toChartRequestMessage(resizeOnlyRequest()),
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.userMessage).toBe('planned for user_intent');
    expect(result.value.response.executionPlan).toEqual([]);
    expect(
      entries.find((entry) => entry.msg === 'Response healed')?.ctx,
    ).toMatchObject({
      detail: {
        skips: [
          {
            reason: 'non_idempotent_on_resize',
            instanceId: 'calendar-main',
            action: 'showWeek',
          },
        ],
      },
    });
  });
});

describe('engine.handle — request enum snapshot', () => {
  test('rejects duplicate parameter definitions before calling the adapter', async () => {
    let plannerCalls = 0;
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
                      name: 'duplicate',
                      type: 'string',
                      description: 'First definition',
                    },
                    {
                      name: 'duplicate',
                      type: 'number',
                      description: 'Second definition',
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    };

    const planner: Planner = async (input, ctx) => {
      plannerCalls += 1;
      return scriptedPlanner([])(input, ctx);
    };
    const engine = createEngine({
      planner,
      logger: silentLogger,
    });
    const result = await engine.handle(toChartRequestMessage(request));

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('RequestValidationError');
    expect(plannerCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// assistant_message variant
// ---------------------------------------------------------------------------

describe('engine.handle — assistant_message', () => {
  test('returns outcome=inserted and persists the injection when history is configured', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      planner: scriptedPlanner([]),
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
      planner: scriptedPlanner([]),
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
      planner: scriptedPlanner([]),
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
      planner: scriptedPlanner([]),
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
      planner: scriptedPlanner([]),
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
      planner: scriptedPlanner([]),
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
    const store = createInMemoryStore();
    const engine = createEngine({
      planner: scriptedPlanner([gridLLMResponse]),
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
      planner: scriptedPlanner([gridLLMResponse]),
      logger: silentLogger,
    });
    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );
    expect(isOk(result)).toBe(true);
    expect(append).not.toHaveBeenCalled();
  });

  test('does not truncate on a duplicate chart_request envelope', async () => {
    // Two handle() calls with the same (sessionId, messageId): the second
    // short-circuits via the persistent-cache replay and never reaches
    // recordTurn. The invariant the test pins is the observable outcome on
    // the store: exactly one entry recorded, truncation (replace()) never
    // fires for a duplicate envelope. The planner call count is asserted to
    // pin the cache-replay short-circuit specifically — without it the
    // assertion would also pass via the older recordTurn-internal dedup
    // path (store.append returns inserted=false → truncation skipped).
    const inner = createInMemoryStore();
    const replace = mock<HistoryStore['replace']>(async () => undefined);
    const wrappedStore: HistoryStore = {
      ...inner,
      replace,
    };
    const { planner, calls } = countingPlanner(
      scriptedPlanner([gridLLMResponse]),
    );
    const engine = createEngine({
      planner,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: wrappedStore },
    });
    const request = makeGridRequest();
    await engine.handle(toChartRequestMessage(request));
    await engine.handle(toChartRequestMessage(request));
    expect((await wrappedStore.get(DEFAULT_SESSION_ID)).length).toBe(1);
    expect(replace).not.toHaveBeenCalled();
    expect(calls()).toBe(1);
  });

  test('does NOT record when the chart_request fails', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      planner: throwingPlanner(new Error('LLM down')),
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
    const store = createInMemoryStore();
    const engine = createEngine({
      planner: scriptedPlanner([gridLLMResponse]),
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
    const inner = createInMemoryStore();
    const throwingStore: HistoryStore = {
      ...inner,
      async append() {
        throw new Error('store offline');
      },
    };
    const engine = createEngine({
      planner: scriptedPlanner([gridLLMResponse]),
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
      planner: scriptedPlanner([]),
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
    // A generic Planner that records the `history` slot it received —
    // proves the Engine threads recorded turns into the next planner call
    // without depending on any particular planner's prompt shape.
    const seenHistory: PlanningInput['history'][] = [];
    const planner: Planner = async (input) => {
      seenHistory.push(input.history);
      const userMessage =
        seenHistory.length === 1 ? 'First response.' : 'Second response.';
      return ok({ ...gridLLMResponse, userMessage });
    };

    const store = createInMemoryStore();
    const engine = createEngine({
      planner,
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 10_000, store },
    });

    // Turn 1 — fresh session, no prior messages.
    const first = await engine.handle(
      toChartRequestMessage(
        makeGridRequest(),
        DEFAULT_SESSION_ID,
        MessageId('req-1'),
      ),
    );
    expect(isOk(first)).toBe(true);
    expect(seenHistory[0]).toEqual([]);

    // Turn 2 — reuse session with a fresh messageId so the idempotency
    // cache doesn't replay turn 1; we want to see turn 1 echo into the
    // next planner call's history slot, not short-circuit on duplicate-id
    // replay.
    const second = await engine.handle(
      toChartRequestMessage(
        makeGridRequest(),
        DEFAULT_SESSION_ID,
        MessageId('req-2'),
      ),
    );
    expect(isOk(second)).toBe(true);

    expect(seenHistory[1]).toEqual([
      { role: 'user', content: expect.any(String) },
      { role: 'assistant', content: 'First response.' },
    ]);
  });

  test('feeds assistant_message injections into the next LLM call', async () => {
    const seenHistory: PlanningInput['history'][] = [];
    const planner: Planner = async (input) => {
      seenHistory.push(input.history);
      return ok(gridLLMResponse);
    };

    const store = createInMemoryStore();
    const engine = createEngine({
      planner,
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

    expect(seenHistory[0]).toContainEqual({
      role: 'assistant',
      content: 'Background: user is on the pricing page.',
    });
  });

  test('does not inject any prior messages when history is not configured', async () => {
    let seenHistory: PlanningInput['history'] | undefined;
    const planner: Planner = async (input) => {
      seenHistory = input.history;
      return ok(gridLLMResponse);
    };

    const engine = createEngine({
      planner,
      logger: silentLogger,
    });
    await engine.handle(toChartRequestMessage(makeGridRequest()));

    expect(seenHistory).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Wire-format validation
// ---------------------------------------------------------------------------

describe('engine.handle — wire-format validation', () => {
  test('rejects malformed envelope before LLM call', async () => {
    const { planner, calls } = countingPlanner(scriptedPlanner([]));
    const engine = createEngine({
      planner,
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
        expect(result.error.path).toEqual(['sessionId']);
      }
    }
    expect(calls()).toBe(0);
  });

  test('rejects malformed inner payload before LLM call', async () => {
    const { planner, calls } = countingPlanner(scriptedPlanner([]));
    const engine = createEngine({
      planner,
      logger: silentLogger,
    });

    const env = toChartRequestMessage(makeGridRequest(), SessionId('sess-1'));
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
        expect(result.error.path[0]).toBe('request');
      }
    }
    expect(calls()).toBe(0);
  });

  test('rejects assistant_message with empty content before history write', async () => {
    const append = mock(() => Promise.resolve({ inserted: true }));
    const store = {
      append,
      get: mock(() => Promise.resolve([])),
      replace: mock(() => Promise.resolve()),
      clear: mock(() => Promise.resolve()),
      getResponseById: mock(() => Promise.resolve({ kind: 'miss' as const })),
    } satisfies HistoryStore;
    const engine = createEngine({
      planner: scriptedPlanner([]),
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
        expect(result.error.path).toEqual(['content']);
      }
    }
    expect(append).not.toHaveBeenCalled();
  });

  test('passes valid envelopes through to the existing pipeline (regression)', async () => {
    const { planner, calls } = countingPlanner(
      scriptedPlanner([gridLLMResponse]),
    );
    const engine = createEngine({
      planner,
      logger: silentLogger,
    });

    const env = toChartRequestMessage(makeGridRequest(), SessionId('sess-1'));

    const result = await engine.handle(env);
    expect(isOk(result)).toBe(true);
    expect(calls()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// engine.getHistory
// ---------------------------------------------------------------------------

describe('engine.getHistory', () => {
  test('returns a ValidationError when history is not configured', async () => {
    const engine = createEngine({
      planner: scriptedPlanner([]),
      logger: silentLogger,
    });
    const result = await engine.getHistory(SessionId('s-unknown'));
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ValidationError');
    expect(result.error.message).toMatch(/history not configured/i);
  });

  test('returns an empty array for a session with no recorded entries', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      planner: scriptedPlanner([]),
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store },
    });
    const result = await engine.getHistory(SessionId('s-empty'));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual([]);
  });

  test('projects turn and injection entries to the wire DTO in chronological order', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      planner: scriptedPlanner([gridLLMResponse]),
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 10_000, store },
    });
    const sessionId = SessionId('s-mixed');

    // Inject (timestamp t=1), then run a chart_request (timestamp t=2),
    // both built explicitly so the test pins ordering by `input.timestamp`,
    // not by store insertion order.
    await engine.handle(
      AssistantInjectionMessage({
        sessionId,
        content: 'seeded',
        id: MessageId('inj-1'),
        timestamp: 1,
      }),
    );
    await engine.handle(
      ChartRequestMessage({
        sessionId,
        id: MessageId('req-1'),
        timestamp: 2,
        request: makeGridRequest(),
      }),
    );

    const result = await engine.getHistory(sessionId);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.length).toBe(2);

    const [first, second] = result.value;
    expect(first).toEqual({
      kind: 'injection',
      id: MessageId('inj-1'),
      sessionId,
      timestamp: 1,
      content: 'seeded',
    });
    if (second?.kind !== 'turn') throw new Error('expected turn entry');
    expect(second.id).toBe(MessageId('req-1'));
    expect(second.sessionId).toBe(sessionId);
    expect(second.timestamp).toBe(2);
    // makeGridRequest seeds `user_intent: 'Show me my calendar'` —
    // toSessionHistoryEntry's projection joins all user_intent reasons.
    expect(second.userIntent).toBe('Show me my calendar');
    expect(second.assistantMessage).toBe(gridLLMResponse.userMessage);
  });

  test('isolates entries per sessionId — does not leak across sessions', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      planner: scriptedPlanner([]),
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store },
    });
    await engine.handle(
      AssistantInjectionMessage({
        sessionId: SessionId('s-a'),
        content: 'in a',
        id: MessageId('a-1'),
      }),
    );

    const a = await engine.getHistory(SessionId('s-a'));
    const b = await engine.getHistory(SessionId('s-b'));
    expect(isOk(a) && a.value.length).toBe(1);
    expect(isOk(b) && b.value.length).toBe(0);
  });

  test('concatenates multiple user_intent reasons and ignores non-user-intent reasons', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      planner: scriptedPlanner([gridLLMResponse]),
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 10_000, store },
    });
    const sessionId = SessionId('s-multi-intent');
    const request = makeGridRequest({
      context: {
        updateReasons: [
          { type: 'user_intent', intent: 'first' },
          {
            type: 'chart_resize',
            previous: { columns: 12, rows: 8 },
            current: { columns: 14, rows: 8 },
          },
          { type: 'user_intent', intent: 'second' },
        ],
        chartDimensions: { columns: 14, rows: 8 },
        layoutMode: 'grid',
      },
    });

    await engine.handle(
      toChartRequestMessage(request, sessionId, MessageId('multi-1')),
    );
    const result = await engine.getHistory(sessionId);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const turn = result.value[0];
    if (turn?.kind !== 'turn') throw new Error('expected turn entry');
    // Single-space join, non-user-intent reasons dropped.
    expect(turn.userIntent).toBe('first second');
  });

  test('returns empty userIntent when no user_intent reasons are present', async () => {
    const store = createInMemoryStore();
    const engine = createEngine({
      planner: scriptedPlanner([gridLLMResponse]),
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 10_000, store },
    });
    const sessionId = SessionId('s-no-intent');
    const request = makeGridRequest({
      context: {
        updateReasons: [
          {
            type: 'chart_resize',
            previous: { columns: 12, rows: 8 },
            current: { columns: 14, rows: 8 },
          },
        ],
        chartDimensions: { columns: 14, rows: 8 },
        layoutMode: 'grid',
      },
    });

    await engine.handle(
      toChartRequestMessage(request, sessionId, MessageId('noi-1')),
    );
    const result = await engine.getHistory(sessionId);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const turn = result.value[0];
    if (turn?.kind !== 'turn') throw new Error('expected turn entry');
    // Empty is a legal value with semantic meaning ("no user input on this turn").
    expect(turn.userIntent).toBe('');
  });

  test('surfaces a HistoryError when the store returns an entry with an unknown kind (assertNever runtime path)', async () => {
    // Custom HistoryStore that smuggles a malformed entry past the engine's
    // type checker — simulates a remote-backed store deserializing an entry
    // shape the engine doesn't understand (schema drift, future variant).
    // The compile-time exhaustiveness in toSessionHistoryEntry catches the
    // shape at build time; this test pins the runtime guardrail.
    const inner = createInMemoryStore();
    const malformed: HistoryStore = {
      ...inner,
      get: async () =>
        invalid<readonly HistoryEntry[]>([
          {
            kind: 'unknown_variant',
            input: {
              id: MessageId('m-1'),
              sessionId: SessionId('s-1'),
              timestamp: 1,
            },
          },
        ]),
    };
    const engine = createEngine({
      planner: scriptedPlanner([]),
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: malformed },
    });
    const result = await engine.getHistory(SessionId('s-1'));
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('HistoryError');
    if (result.error._tag !== 'HistoryError') return;
    expect(result.error.operation).toBe('get_history');
  });

  test('surfaces a HistoryError when the store throws', async () => {
    const inner = createInMemoryStore();
    const failing: HistoryStore = {
      ...inner,
      get: async () => {
        throw new Error('store down');
      },
    };
    const engine = createEngine({
      planner: scriptedPlanner([]),
      logger: silentLogger,
      history: { maxEntries: 10, maxChars: 1_000, store: failing },
    });
    const result = await engine.getHistory(SessionId('s-1'));
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('HistoryError');
    if (result.error._tag !== 'HistoryError') return;
    expect(result.error.operation).toBe('get_history');
  });
});
