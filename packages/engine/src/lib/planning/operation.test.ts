import { describe, expect, test } from 'bun:test';
import {
  ActionName,
  ChartRequestMessage,
  isErr,
  isOk,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';

import {
  buildGridResponse,
  makeGridRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import { createEngine } from '../engine.js';
import type { Planner, PlannerCandidate } from './contracts.js';

const message = (id = 'planning-test') =>
  ChartRequestMessage({
    sessionId: SessionId('planning'),
    id: MessageId(id),
    request: makeGridRequest(),
  });

const candidate = (response = buildGridResponse()): PlannerCandidate => ({
  userMessage: response.userMessage,
  rationale: response.rationale,
  layout: response.layout,
  executionPlan: response.executionPlan.map((action) => ({
    instanceId: action.instanceId,
    action: action.action,
    ...(action.paramsJson !== undefined && { params: action.paramsJson }),
  })),
});

const invalidCandidate = (): PlannerCandidate => ({
  ...candidate(),
  layout: {
    positions: [
      {
        instanceId: 'missing',
        position: { row: 0, column: 0 },
        size: { width: 6, height: 4 },
      },
    ],
  },
});

const route = (implementation: Planner, maxRepairAttempts = 0) => ({
  implementation,
  finalization: 'strict' as const,
  maxRepairAttempts,
});

describe('explicit planner routes', () => {
  test('repairs a strict rejected proposal with actionable public feedback', async () => {
    const phases: string[] = [];
    const planner: Planner = {
      id: 'repairing-fake',
      supportedLayoutModes: ['grid'],
      async invoke(invocation) {
        phases.push(invocation.phase.kind);
        invocation.context.calls.claim({
          plannerId: this.id,
          stage: invocation.phase.kind,
        });
        if (invocation.phase.kind === 'repair') {
          expect(invocation.phase.report.issues).toContainEqual(
            expect.objectContaining({ code: 'unknown_instance' }),
          );
          return ok({ kind: 'candidate', candidate: candidate() });
        }
        return ok({
          kind: 'candidate',
          candidate: invalidCandidate(),
        });
      },
    };
    const result = await createEngine({
      planner: {
        primary: route(planner, 1),
        operation: { timeoutMs: null, maxProviderCalls: 2 },
      },
      logger: silentLogger,
    }).handle(message('repair'));

    expect(isOk(result)).toBe(true);
    expect(phases).toEqual(['initial', 'repair']);
  });

  test('does not ship a strict subset and falls back once after finalization', async () => {
    let fallbackCalls = 0;
    const invalid: Planner = {
      id: 'invalid',
      supportedLayoutModes: ['grid'],
      async invoke(invocation) {
        invocation.context.calls.claim({
          plannerId: this.id,
          stage: 'initial',
        });
        return ok({ kind: 'candidate', candidate: invalidCandidate() });
      },
    };
    const fallback: Planner = {
      id: 'fallback',
      supportedLayoutModes: ['grid'],
      async invoke(invocation) {
        fallbackCalls += 1;
        invocation.context.calls.claim({
          plannerId: this.id,
          stage: 'initial',
        });
        return ok({ kind: 'candidate', candidate: candidate() });
      },
    };
    const result = await createEngine({
      planner: {
        primary: route(invalid),
        fallback: { ...route(fallback), on: ['invalid_plan'] },
        operation: { timeoutMs: null, maxProviderCalls: 2 },
      },
      logger: silentLogger,
    }).handle(message('fallback'));

    expect(isOk(result)).toBe(true);
    expect(fallbackCalls).toBe(1);
  });

  test('accepts strict non-material healing but rejects malformed canonical fields', async () => {
    const warningOnly = candidate(buildGridResponse({ rationale: '' }));
    const accepted = await createEngine({
      planner: {
        primary: route({
          id: 'warning',
          supportedLayoutModes: ['grid'],
          async invoke() {
            return ok({ kind: 'candidate', candidate: warningOnly });
          },
        }),
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      logger: silentLogger,
    }).handle(message('warning'));
    expect(isOk(accepted)).toBe(true);

    const malformed = candidate();
    (malformed.layout as { positions: unknown[] }).positions[0] = {
      instanceId: 'calendar-main',
      position: { row: -1, column: 0 },
      size: { width: 6, height: 4 },
    };
    const rejected = await createEngine({
      planner: {
        primary: route({
          id: 'malformed',
          supportedLayoutModes: ['grid'],
          async invoke() {
            return ok({ kind: 'candidate', candidate: malformed });
          },
        }),
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      logger: silentLogger,
    }).handle(message('malformed'));
    expect(isErr(rejected)).toBe(true);
    if (isErr(rejected))
      expect(rejected.error._tag).toBe('PlanningDeferredError');
  });

  test('preserves decoded parameters and freezes the shared request through fallback', async () => {
    let fallbackInputFrozen = false;
    const request = makeGridRequest();
    const instance = request.instances[0];
    if (instance === undefined)
      throw new Error('fixture requires one instance');
    const vessel = request.vessels.find(
      (entry) => entry.id === instance.vesselId,
    );
    if (vessel === undefined) throw new Error('fixture vessel missing');
    vessel.variants[instance.variant]?.actions.push({
      name: ActionName('setOptional'),
      description: 'Set a value',
      idempotent: true,
      parameters: [
        {
          name: 'value',
          type: 'string',
          description: 'Value',
          required: false,
        },
      ],
    });
    const primary: Planner = {
      id: 'primary',
      supportedLayoutModes: ['grid'],
      async invoke(invocation) {
        invocation.context.calls.claim({
          plannerId: this.id,
          stage: 'initial',
        });
        expect(Object.isFrozen(invocation.input.request)).toBe(true);
        expect(Object.isFrozen(invocation.input.request.vessels)).toBe(true);
        return ok({ kind: 'deferred', reason: 'uncertain' });
      },
    };
    const fallback: Planner = {
      id: 'fallback',
      supportedLayoutModes: ['grid'],
      async invoke(invocation) {
        fallbackInputFrozen = Object.isFrozen(
          invocation.input.request.instances,
        );
        invocation.context.calls.claim({
          plannerId: this.id,
          stage: 'initial',
        });
        const response = candidate();
        return ok({
          kind: 'candidate',
          candidate: {
            ...response,
            executionPlan: [
              {
                instanceId: instance.instanceId,
                action: 'setOptional',
                params: { value: 'keep-me' },
              },
            ],
          },
        });
      },
    };
    const result = await createEngine({
      planner: {
        primary: route(primary),
        fallback: { ...route(fallback), on: ['deferred'] },
        operation: { timeoutMs: null, maxProviderCalls: 2 },
      },
      logger: silentLogger,
    }).handle(
      ChartRequestMessage({
        sessionId: SessionId('frozen'),
        id: MessageId('frozen'),
        request,
      }),
    );

    expect(fallbackInputFrozen).toBe(true);
    expect(isOk(result)).toBe(true);
    if (isOk(result) && result.value.type === 'chart_response') {
      expect(result.value.response.executionPlan[0]?.params).toEqual({
        value: 'keep-me',
      });
    }
  });

  test('stops fallback and repair when the shared logical budget is exhausted', async () => {
    let fallbackCalls = 0;
    const primary: Planner = {
      id: 'primary',
      supportedLayoutModes: ['grid'],
      async invoke(invocation) {
        invocation.context.calls.claim({
          plannerId: this.id,
          stage: 'initial',
        });
        return ok({ kind: 'deferred', reason: 'uncertain' });
      },
    };
    const fallback: Planner = {
      id: 'fallback',
      supportedLayoutModes: ['grid'],
      async invoke() {
        fallbackCalls += 1;
        return ok({ kind: 'candidate', candidate: candidate() });
      },
    };
    const result = await createEngine({
      planner: {
        primary: route(primary),
        fallback: { ...route(fallback), on: ['deferred'] },
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      logger: silentLogger,
    }).handle(message('budget'));

    expect(isErr(result)).toBe(true);
    if (isErr(result))
      expect(result.error._tag).toBe('PlanningBudgetExceededError');
    expect(fallbackCalls).toBe(0);
  });

  test('gives caller cancellation precedence and preserves deadline duration', async () => {
    const controller = new AbortController();
    controller.abort('caller-stop');
    const unsupported: Planner = {
      id: 'tiling-only',
      supportedLayoutModes: ['tiling'],
      async invoke() {
        throw new Error('must not invoke');
      },
    };
    const cancelled = await createEngine({
      planner: {
        primary: route(unsupported),
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      logger: silentLogger,
    }).handle(message('cancelled'), controller.signal);
    expect(isErr(cancelled)).toBe(true);
    if (isErr(cancelled)) {
      expect(cancelled.error).toMatchObject({
        _tag: 'CancellationError',
        reason: 'caller-stop',
      });
    }

    const timedOut = await createEngine({
      planner: {
        primary: {
          implementation: {
            id: 'pending',
            supportedLayoutModes: ['grid'],
            invoke: async () => new Promise(() => {}),
          },
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: 5, maxProviderCalls: 1 },
      },
      logger: silentLogger,
    }).handle(message('timeout'));
    expect(isErr(timedOut)).toBe(true);
    if (isErr(timedOut))
      expect(timedOut.error).toMatchObject({
        _tag: 'TimeoutError',
        timeoutMs: 5,
      });
  });
});
