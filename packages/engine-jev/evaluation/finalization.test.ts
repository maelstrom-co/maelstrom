import { describe, expect, test } from 'bun:test';
import {
  createEngine,
  createInMemoryStore,
  createLlmPlanner,
  type Logger,
  type Planner,
  type PlannerCandidate,
} from '@maelstrom-co/engine';
import {
  ChartRequestMessage,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import { request } from './fixtures.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const sessionId = SessionId('finalization-regression');
type Adapter = Parameters<typeof createLlmPlanner>[0]['adapter'];

function adapterFor(candidate: PlannerCandidate) {
  let calls = 0;
  const adapter = {
    kind: 'text',
    name: 'offline-regression',
    model: 'offline-regression',
    chatStream() {
      throw new Error('unexpected streaming call');
    },
    async structuredOutput() {
      calls++;
      const data = {
        userMessage: 'Updated.',
        rationale: 'Offline regression.',
        layout: candidate.layout,
        executionPlan: candidate.executionPlan.map(({ params, ...action }) => ({
          ...action,
          ...(params === undefined
            ? {}
            : { paramsJson: JSON.stringify(params) }),
        })),
      };
      return { data, rawText: JSON.stringify(data) };
    },
  } as unknown as Adapter;
  return { adapter, calls: () => calls };
}

function thirdParty(candidate: PlannerCandidate): Planner {
  return {
    id: 'third-party',
    supportedLayoutModes: ['tiling', 'grid'],
    async invoke() {
      return { ok: true, value: { kind: 'candidate', candidate } };
    },
  };
}

function message(input: ReturnType<typeof request>) {
  return ChartRequestMessage({
    sessionId,
    id: MessageId('regression'),
    request: input,
  });
}

describe('finalization through Engine.handle', () => {
  test.each([
    'removed',
    'retained',
  ] as const)('strict grid routes validate actions only on %s post-layout targets', async (target) => {
    const base = request('Configure the remaining weather panel.');
    const position = {
      instanceId: 'weather-main',
      position: { row: 0, column: 0 },
      size: { width: 4, height: 4 },
    };
    const input = request('Configure the remaining weather panel.', {
      context: { ...base.context, layoutMode: 'grid' },
      layout: {
        type: 'grid',
        positions: [
          position,
          {
            ...position,
            instanceId: 'tasks-main',
            position: { row: 0, column: 4 },
          },
        ],
      },
    });
    const candidate = {
      layout: { type: 'grid', positions: [position] },
      executionPlan:
        target === 'removed'
          ? [
              {
                instanceId: 'tasks-main',
                action: 'complete',
                params: { title: 'Buy milk' },
              },
            ]
          : [
              {
                instanceId: 'weather-main',
                action: 'setLocation',
                params: { location: 'Tokyo' },
              },
            ],
    };
    for (const implementation of [
      thirdParty(candidate),
      createLlmPlanner({ adapter: adapterFor(candidate).adapter, logger }),
    ]) {
      const engine = createEngine({
        planner: {
          primary: {
            implementation,
            finalization: 'strict',
            maxRepairAttempts: 0,
          },
          operation: { timeoutMs: null, maxProviderCalls: 1 },
        },
        history: { store: createInMemoryStore() },
        logger,
      });
      const result = await engine.handle(message(input));
      if (target === 'removed') {
        expect(result).toMatchObject({
          ok: false,
          error: { _tag: 'PlanningDeferredError', reason: 'invalid_plan' },
        });
        expect(await engine.getHistory(sessionId)).toEqual({
          ok: true,
          value: [],
        });
      } else
        expect(result).toMatchObject({
          ok: true,
          value: { response: { executionPlan: candidate.executionPlan } },
        });
    }
    const legacy = await createEngine({
      adapter: adapterFor(candidate).adapter,
      logger,
    }).handle(message(input));
    expect(legacy).toMatchObject({
      ok: true,
      value: { response: { executionPlan: candidate.executionPlan } },
    });
  });
  test.each([
    'work',
    'depth',
  ] as const)('legacy adapter skips only the action exceeding the parameter %s limit', async (limit) => {
    const input = request('Configure weather and show the weekly forecast.');
    let payload: unknown = Array.from({ length: 4097 }, () => 0);
    if (limit === 'depth') {
      payload = 0;
      for (let depth = 0; depth < 34; depth++) payload = { nested: payload };
    }
    const candidate = {
      layout: input.layout,
      executionPlan: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { payload },
        },
        { instanceId: 'weather-main', action: 'showWeekly' },
      ],
    };
    const script = adapterFor(candidate);
    const logs: { message: string; data?: Record<string, unknown> }[] = [];
    const capture = (message: string, data?: Record<string, unknown>) => {
      logs.push({ message, data });
    };
    const capturedLogger: Logger = {
      debug: capture,
      info: capture,
      warn: capture,
      error(message, _error, data) {
        capture(message, data);
      },
    };
    const engine = createEngine({
      adapter: script.adapter,
      logger: capturedLogger,
      history: { store: createInMemoryStore() },
    });
    const result = await engine.handle(message(input));
    expect(result).toMatchObject({
      ok: true,
      value: {
        type: 'chart_response',
        response: {
          layout: {
            type: 'tiling',
            tree: ['V', 'ID:weather-main', 'ID:tasks-main'],
            instances: input.instances,
          },
          executionPlan: [{ instanceId: 'weather-main', action: 'showWeekly' }],
        },
      },
    });
    expect(script.calls()).toBe(1);
    expect(logs).toContainEqual(
      expect.objectContaining({
        message: 'Response healed',
        data: expect.objectContaining({
          skippedActions: 1,
          retryRecommend: false,
          detail: expect.objectContaining({
            skips: [{ reason: 'params_limits_exceeded' }],
          }),
        }),
      }),
    );
    expect(
      logs.some((entry) =>
        entry.message.includes(
          limit === 'work' ? 'traversal limit' : 'depth limit',
        ),
      ),
    ).toBe(true);
    const history = await engine.getHistory(sessionId);
    expect(history.ok).toBe(true);
    if (history.ok) expect(history.value).toHaveLength(1);
  });

  test.each([
    'deleted',
    'changed-variant',
  ] as const)('strict routes reject actions using the request state after an instance is %s by the layout', async (change) => {
    const input = request('Change the layout and configure weather.');
    const layout = {
      type: 'tiling',
      tree:
        change === 'deleted'
          ? ['ID:tasks-main']
          : ['V:1,1', 'ID:weather-main', 'ID:tasks-main'],
      instances:
        change === 'deleted'
          ? input.instances.filter(
              (instance) => instance.instanceId !== 'weather-main',
            )
          : input.instances.map((instance) =>
              instance.instanceId === 'weather-main'
                ? { ...instance, variant: 'weekly' }
                : instance,
            ),
    };
    const candidate = {
      layout,
      executionPlan: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Tokyo' },
        },
      ],
    };
    for (const implementation of [
      thirdParty(candidate),
      createLlmPlanner({ adapter: adapterFor(candidate).adapter, logger }),
    ]) {
      const engine = createEngine({
        planner: {
          primary: {
            implementation,
            finalization: 'strict',
            maxRepairAttempts: 0,
          },
          operation: { timeoutMs: null, maxProviderCalls: 1 },
        },
        history: { store: createInMemoryStore() },
        logger,
      });
      const result = await engine.handle(message(input));
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: 'PlanningDeferredError', reason: 'invalid_plan' },
      });
      expect(await engine.getHistory(sessionId)).toEqual({
        ok: true,
        value: [],
      });
    }
    const legacy = adapterFor(candidate);
    const result = await createEngine({
      adapter: legacy.adapter,
      logger,
    }).handle(message(input));
    expect(result).toMatchObject({
      ok: true,
      value: { response: { executionPlan: candidate.executionPlan } },
    });
    expect(legacy.calls()).toBe(1);
  });

  test('strict action simulation starts with layout variants and includes hidden and new instances', async () => {
    const input = request(
      'Use the declared variants and configure retained and new weather.',
    );
    const candidate = {
      layout: {
        type: 'tiling',
        tree: ['ID:weather-main'],
        instances: [
          ...input.instances.map((instance) =>
            instance.instanceId === 'weather-main'
              ? { ...instance, variant: 'weekly' }
              : instance,
          ),
          {
            instanceId: 'weather-new',
            vesselId: 'weather',
            variant: 'current',
          },
        ],
      },
      executionPlan: [
        { instanceId: 'weather-main', action: 'showCurrent' },
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Tokyo' },
        },
        {
          instanceId: 'weather-hidden',
          action: 'setLocation',
          params: { location: 'Paris' },
        },
        {
          instanceId: 'weather-new',
          action: 'setLocation',
          params: { location: 'Rome' },
        },
      ],
    };
    for (const implementation of [
      thirdParty(candidate),
      createLlmPlanner({ adapter: adapterFor(candidate).adapter, logger }),
    ]) {
      const engine = createEngine({
        planner: {
          primary: {
            implementation,
            finalization: 'strict',
            maxRepairAttempts: 0,
          },
          operation: { timeoutMs: null, maxProviderCalls: 1 },
        },
        logger,
      });
      expect(await engine.handle(message(input))).toMatchObject({
        ok: true,
        value: {
          response: {
            layout: candidate.layout,
            executionPlan: candidate.executionPlan,
          },
        },
      });
    }
  });

  test('strict finalization rejects oversized LLM JSON instead of shipping its otherwise valid action', async () => {
    const input = request('Configure weather and show weekly.');
    const script = adapterFor({
      layout: input.layout,
      executionPlan: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { payload: Array.from({ length: 4097 }, () => 0) },
        },
        { instanceId: 'weather-main', action: 'showWeekly' },
      ],
    });
    const engine = createEngine({
      planner: {
        primary: {
          implementation: createLlmPlanner({ adapter: script.adapter, logger }),
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      logger,
      history: { store: createInMemoryStore() },
    });
    expect(await engine.handle(message(input))).toMatchObject({
      ok: false,
      error: { _tag: 'PlanningDeferredError', reason: 'invalid_plan' },
    });
    expect(await engine.getHistory(sessionId)).toEqual({ ok: true, value: [] });
    expect(script.calls()).toBe(1);
  });

  test.each([
    'cycle',
    'non-json',
    'depth',
    'work',
  ] as const)('strict third-party decoded %s parameters remain a whole-plan rejection', async (kind) => {
    const input = request('Configure weather.');
    const params: Record<string, unknown> = {};
    if (kind === 'cycle') params.self = params;
    if (kind === 'non-json') params.value = () => 'not JSON';
    if (kind === 'work') params.payload = Array.from({ length: 4097 }, () => 0);
    if (kind === 'depth') {
      let value: unknown = 0;
      for (let depth = 0; depth < 34; depth++) value = { value };
      params.payload = value;
    }
    const engine = createEngine({
      planner: {
        primary: {
          implementation: thirdParty({
            layout: input.layout,
            executionPlan: [
              { instanceId: 'weather-main', action: 'setLocation', params },
              { instanceId: 'weather-main', action: 'showWeekly' },
            ],
          }),
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      logger,
      history: { store: createInMemoryStore() },
    });
    expect(await engine.handle(message(input))).toMatchObject({
      ok: false,
      error: { _tag: 'PlanningDeferredError', reason: 'invalid_plan' },
    });
    expect(await engine.getHistory(sessionId)).toEqual({ ok: true, value: [] });
  });

  test('factory system customizers throw synchronously while user customizers fail through Engine.handle', async () => {
    const input = request('Preserve this board.');
    const script = adapterFor({ layout: input.layout, executionPlan: [] });
    expect(() =>
      createLlmPlanner({
        adapter: script.adapter,
        prompt: { system: { unknownSection: () => 'invalid' } },
      }),
    ).toThrow('is not a default section');
    expect(() =>
      createLlmPlanner({
        adapter: script.adapter,
        prompt: {
          system: {
            rules() {
              throw new Error('system failure');
            },
          },
        },
      }),
    ).toThrow('system failure');
    const planner = createLlmPlanner({
      adapter: script.adapter,
      prompt: {
        user: {
          vessels() {
            throw new Error('user failure');
          },
        },
      },
      logger,
    });
    const engine = createEngine({
      planner: {
        primary: {
          implementation: planner,
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      logger,
    });
    expect(await engine.handle(message(input))).toMatchObject({
      ok: false,
      error: { _tag: 'ValidationError' },
    });
    expect(script.calls()).toBe(0);
  });
});
