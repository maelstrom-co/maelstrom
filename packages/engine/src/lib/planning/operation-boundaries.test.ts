import { describe, expect, test } from 'bun:test';
import {
  ActionName,
  type ChartRequest,
  ChartRequestMessage,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';

import {
  createEngine,
  createInMemoryStore,
  type FinalizationReport,
  type Planner,
  type PlannerCandidate,
  type PlannerProposal,
  resolveConfig,
} from '../../index.js';
import {
  buildGridResponse,
  dummyAdapter,
  makeGridRequest,
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';

const valid = (): PlannerCandidate => ({
  ...buildGridResponse(),
  executionPlan: [],
});
const proposal = (candidate: PlannerCandidate) =>
  ok({ kind: 'candidate' as const, candidate });
const message = (id: string, request: ChartRequest = makeGridRequest()) =>
  ChartRequestMessage({
    sessionId: SessionId('operation-boundaries'),
    id: MessageId(id),
    request,
  });
const fake = (invoke: Planner['invoke']): Planner => ({
  id: 'boundary',
  supportedLayoutModes: ['grid', 'tiling'],
  invoke,
});
const route = (implementation: Planner, maxRepairAttempts = 0) => ({
  implementation,
  finalization: 'strict' as const,
  maxRepairAttempts,
});
const strict = (implementation: Planner) =>
  createEngine({
    planner: {
      primary: route(implementation),
      operation: { timeoutMs: null, maxProviderCalls: 4 },
    },
    logger: silentLogger,
  });

describe('planner boundary behavior', () => {
  test('preserves the resolved adapter return type and defaults for existing callers', () => {
    const resolved = resolveConfig({ adapter: dummyAdapter });
    expect(resolved.adapter).toBe(dummyAdapter);
    expect(resolved.maxRetries).toBe(1);
    expect(resolved.prompt).toEqual({});
  });

  test.each([
    false,
    true,
  ])('keeps legacy retry events for canonical empty proposals (exhausted=%s)', async (exhausted) => {
    const events: string[] = [];
    let calls = 0;
    const implementation = fake(async ({ context }) => {
      context.calls.claim({ plannerId: 'legacy', stage: 'attempt' });
      calls++;
      return proposal(
        exhausted || calls === 1
          ? { ...valid(), layout: { positions: [] } }
          : valid(),
      );
    });
    const engine = createEngine({
      planner: {
        primary: { ...route(implementation, 1), finalization: 'heal-and-ship' },
        operation: { timeoutMs: null, maxProviderCalls: 2 },
      },
      logger: {
        ...silentLogger,
        info: (message) => {
          events.push(message);
        },
        warn: (message) => {
          events.push(message);
        },
        error: (message) => {
          events.push(message);
        },
      },
    });
    const result = await engine.handle(message(`legacy-retry-${exhausted}`));
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(events).toContain('Retrying after recommended retry');
    expect(events).toContain(
      exhausted ? 'Retries exhausted' : 'Retry succeeded',
    );
  });

  test('preserves reserved JSON keys rather than changing selected parameter values', async () => {
    const request = makeGridRequest();
    const instance = request.instances[0];
    const vessel = request.vessels.find((v) => v.id === instance.vesselId)!;
    vessel.variants[instance.variant].actions.push({
      name: ActionName('metadata'),
      description: 'Store metadata',
      idempotent: true,
      parameters: [
        { name: '__proto__', type: 'string', description: 'Reserved key' },
        { name: 'metadata', type: 'object', description: 'Nested metadata' },
      ],
    });
    const params = JSON.parse(
      '{"__proto__":"top","metadata":{"__proto__":{"x":1}}}',
    );
    const shared = { id: 7 };
    params.metadata.first = shared;
    params.metadata.second = shared;
    const result = await strict(
      fake(async () =>
        proposal({
          ...valid(),
          executionPlan: [
            { instanceId: instance.instanceId, action: 'metadata', params },
          ],
        }),
      ),
    ).handle(message('reserved-keys', request));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'chart_response')
      expect(result.value.response.executionPlan[0].params).toEqual(params);
  });

  test.each([
    'mode',
    'parameters',
    'controls',
  ] as const)('provides bounded actionable repair information for %s failures', async (failure) => {
    let report: FinalizationReport | undefined;
    const response = buildGridResponse();
    const malformed: PlannerCandidate =
      failure === 'mode'
        ? { ...valid(), layout: { ...response.layout, type: 'tiling' } }
        : failure === 'parameters'
          ? {
              ...valid(),
              executionPlan: [
                { instanceId: 'calendar-main', action: 'anything', params: 42 },
              ],
            }
          : {
              ...valid(),
              layout: {
                positions: [
                  {
                    ...response.layout.positions[0],
                    instanceId: 'unknown\ninstance',
                  },
                ],
              },
            };
    const engine = createEngine({
      planner: {
        primary: route(
          fake(async ({ phase }) => {
            if (phase.kind === 'initial') return proposal(malformed);
            report = phase.report;
            return proposal(valid());
          }),
          1,
        ),
        operation: { timeoutMs: null, maxProviderCalls: 2 },
      },
      logger: silentLogger,
    });
    expect((await engine.handle(message(`report-${failure}`))).ok).toBe(true);
    expect(report).toBeDefined();
    if (failure === 'mode')
      expect(report?.issues[0]).toMatchObject({
        code: 'layout_mode_mismatch',
        location: { path: ['layout', 'type'] },
      });
    if (failure === 'parameters')
      expect(report?.issues[0]).toMatchObject({
        code: 'invalid_parameters',
        location: { actionIndex: 0, path: ['executionPlan', 0, 'params'] },
      });
    if (failure === 'controls')
      expect(
        report?.issues.every((issue) => !/[\n\r\t]/.test(issue.message)),
      ).toBe(true);
  });
  test.each([
    ['negative', -1],
    ['fractional', 0.25],
    ['not finite', Number.NaN],
    ['string', '0'],
  ])('rejects %s grid coordinates before exposing a canonical response', async (label, row) => {
    const candidate = valid();
    const response = {
      ...candidate,
      layout: {
        positions: [
          {
            instanceId: 'calendar-main',
            position: { row, column: 0 },
            size: { width: 6, height: 4 },
          },
        ],
      },
    };
    const result = await strict(fake(async () => proposal(response))).handle(
      message(String(label)),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe('PlanningDeferredError');
  });

  test('rejects a layout discriminator that contradicts the request', async () => {
    const response = buildGridResponse();
    const result = await strict(
      fake(async () =>
        proposal({
          ...response,
          layout: { ...response.layout, type: 'tiling' },
        }),
      ),
    ).handle(message('mode'));
    expect(result.ok).toBe(false);
  });

  test.each([
    ['hide all', []],
    ['reserve empty space', ['V', null, null]],
  ] as const)('allows a complete tiling plan to %s without inventing visible Instances', async (label, tree) => {
    const request = makeTilingRequest();
    const result = await strict(
      fake(async () =>
        proposal({
          userMessage: 'Hidden',
          rationale: 'Requested visibility',
          executionPlan: [],
          layout: { type: 'tiling', tree, instances: request.instances },
        }),
      ),
    ).handle(message(String(label), request));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'chart_response') {
      expect(result.value.response.layout.type).toBe('tiling');
      if (result.value.response.layout.type === 'tiling') {
        expect(result.value.response.layout.tree).toEqual(tree);
        expect(result.value.response.layout.instances).toHaveLength(1);
      }
    }
  });

  test('allows explicit deletion of every retained Instance', async () => {
    const result = await strict(
      fake(async () =>
        proposal({
          userMessage: 'Cleared',
          rationale: 'Requested deletion',
          executionPlan: [],
          layout: { type: 'tiling', tree: [], instances: [] },
        }),
      ),
    ).handle(message('delete-all', makeTilingRequest()));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'chart_response')
      expect(result.value.response.layout).toEqual({
        type: 'tiling',
        tree: [],
        instances: [],
      });
  });

  test('does not treat repaired split weights as exact intended geometry', async () => {
    const request = makeTilingRequest();
    const result = await strict(
      fake(async () =>
        proposal({
          userMessage: 'Layout',
          rationale: 'Requested layout',
          executionPlan: [],
          layout: {
            type: 'tiling',
            tree: ['V:0,2', 'ID:calendar-main', null],
            instances: request.instances,
          },
        }),
      ),
    ).handle(message('bad-weights', request));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe('PlanningDeferredError');
  });

  test('contains cyclic decoded parameters in the typed failure boundary', async () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    const result = await strict(
      fake(async () =>
        proposal({
          ...valid(),
          executionPlan: [
            {
              instanceId: 'calendar-main',
              action: 'anything',
              params: { value },
            },
          ],
        }),
      ),
    ).handle(message('cyclic'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe('PlanningDeferredError');
  });

  test('contains throwing parameter accessors in the typed failure boundary', async () => {
    const params = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        throw new Error('getter failed');
      },
    });
    const result = await strict(
      fake(async () =>
        proposal({
          ...valid(),
          executionPlan: [
            { instanceId: 'calendar-main', action: 'anything', params },
          ],
        }),
      ),
    ).handle(message('getter'));
    expect(result.ok).toBe(false);
  });

  test('checks the absolute deadline after synchronous planner work', async () => {
    const engine = createEngine({
      planner: {
        primary: route(
          fake(async () => {
            const start = Date.now();
            while (Date.now() - start < 15) {}
            return proposal(valid());
          }),
        ),
        operation: { timeoutMs: 1, maxProviderCalls: 1 },
      },
      logger: silentLogger,
    });
    const result = await engine.handle(message('synchronous-deadline'));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        _tag: 'TimeoutError',
        timeoutMs: 1,
      });
  });

  test('does not persist a late provider result after an operation deadline', async () => {
    let complete: ((value: ReturnType<typeof proposal>) => void) | undefined;
    const engine = createEngine({
      planner: {
        primary: route(
          fake(
            () =>
              new Promise((resolve) => {
                complete = resolve;
              }),
          ),
        ),
        operation: { timeoutMs: 5, maxProviderCalls: 1 },
      },
      logger: silentLogger,
      history: { store: createInMemoryStore() },
    });
    const result = await engine.handle(message('late-result'));
    expect(result.ok).toBe(false);
    complete?.(proposal(valid()));
    await Promise.resolve();
    await Promise.resolve();
    const history = await engine.getHistory(SessionId('operation-boundaries'));
    expect(history).toEqual(ok([]));
  });

  test('deduplicates the complete fallback operation and records only the winning response', async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    let complete: ((value: ReturnType<typeof proposal>) => void) | undefined;
    const engine = createEngine({
      planner: {
        primary: route(
          fake(async ({ context }) => {
            primaryCalls++;
            context.calls.claim({ plannerId: 'primary', stage: 'initial' });
            return ok({
              kind: 'deferred',
              reason: 'uncertain',
            } satisfies PlannerProposal);
          }),
        ),
        fallback: {
          ...route(
            fake(() => {
              fallbackCalls++;
              return new Promise((resolve) => {
                complete = resolve;
              });
            }),
          ),
          on: ['deferred'],
        },
        operation: { timeoutMs: null, maxProviderCalls: 2 },
      },
      logger: silentLogger,
      history: { store: createInMemoryStore() },
    });
    const request = message('dedup-fallback');
    const leader = engine.handle(request);
    const follower = engine.handle(request);
    for (let turn = 0; turn < 20 && !complete; turn++) await Promise.resolve();
    expect(complete).toBeDefined();
    complete?.(proposal(valid()));
    const [first, second] = await Promise.all([leader, follower]);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
    const history = await engine.getHistory(SessionId('operation-boundaries'));
    expect(history.ok).toBe(true);
    if (history.ok) expect(history.value).toHaveLength(1);
  });
});
