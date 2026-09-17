import { describe, expect, test } from 'bun:test';
import {
  ChartRequestMessage,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';

import {
  buildGridResponse,
  makeGridRequest,
} from '../__test-helpers__/fixtures.js';
import { createEngine } from '../engine.js';
import type { Logger } from '../logger.js';
import type { Planner } from './contracts.js';

function capture() {
  const events: { event: string; data?: Record<string, unknown> }[] = [];
  const log = (event: string, data?: Record<string, unknown>) => {
    events.push({ event, data });
  };
  const logger: Logger = {
    debug: log,
    info: log,
    warn: log,
    error: (event, _error, data) => log(event, data),
  };
  return { logger, events };
}
const message = () =>
  ChartRequestMessage({
    id: MessageId('logging-request'),
    sessionId: SessionId('logging-session'),
    request: makeGridRequest({
      context: {
        ...makeGridRequest().context,
        updateReasons: [{ type: 'user_intent', intent: 'private user text' }],
      },
    }),
  });
const route = (implementation: Planner) => ({
  implementation,
  finalization: 'strict' as const,
  maxRepairAttempts: 0,
});
const candidate = () =>
  ok({ kind: 'candidate' as const, candidate: buildGridResponse() });

describe('planner operation telemetry', () => {
  test('keeps policy diagnostics without misreporting a semantic deferral as an LLM failure', async () => {
    const { logger, events } = capture();
    const engine = createEngine({
      logger,
      planner: {
        primary: route({
          id: 'typesafe-jev',
          supportedLayoutModes: ['grid'],
          async invoke() {
            return ok({
              kind: 'deferred',
              reason: 'policy',
              detail: {
                limit: 'missing_candidates',
                stage: 'parameters',
                parameter: 'location',
              },
            });
          },
        }),
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
    });
    expect((await engine.handle(message())).ok).toBe(false);
    expect(events).toContainEqual({
      event: 'planning.deferred',
      data: {
        messageId: 'logging-request',
        plannerId: 'typesafe-jev',
        reason: 'policy',
        detail: {
          limit: 'missing_candidates',
          stage: 'parameters',
          parameter: 'location',
        },
      },
    });
    expect(events.some(({ event }) => event === 'LLM call failed')).toBe(false);
  });
  test.each([
    false,
    true,
  ])('distinguishes a deterministic plan from provider work (claimed=%s)', async (claimed) => {
    const { logger, events } = capture();
    const engine = createEngine({
      logger,
      planner: {
        primary: route({
          id: 'primary',
          supportedLayoutModes: ['grid'],
          async invoke({ context }) {
            if (claimed)
              context.calls.claim({ plannerId: 'primary', stage: 'layout' });
            return candidate();
          },
        }),
        operation: { timeoutMs: null, maxProviderCalls: 3 },
      },
    });
    expect((await engine.handle(message())).ok).toBe(true);
    const telemetry = events.filter(({ event }) =>
      event.startsWith('planning.'),
    );
    expect(
      telemetry.filter(({ event }) => event === 'planning.provider_call'),
    ).toHaveLength(claimed ? 1 : 0);
    expect(telemetry.at(-1)).toMatchObject({
      event: 'planning.completed',
      data: {
        messageId: 'logging-request',
        plannerId: 'primary',
        fallbackUsed: false,
        outcome: 'success',
        providerCalls: claimed ? 1 : 0,
      },
    });
    expect(
      telemetry.every(({ data }) => data?.messageId === 'logging-request'),
    ).toBe(true);
    expect(JSON.stringify(telemetry)).not.toContain('private user text');
    expect(JSON.stringify(telemetry)).not.toContain('calendar-main');
  });

  test.each([
    1, 2,
  ])('reports actual fallback execution rather than its configuration (budget=%s)', async (budget) => {
    const { logger, events } = capture();
    const engine = createEngine({
      logger,
      planner: {
        primary: route({
          id: 'typesafe-jev',
          supportedLayoutModes: ['grid'],
          async invoke({ context }) {
            context.calls.claim({ plannerId: 'typesafe-jev', stage: 'layout' });
            return ok({ kind: 'deferred', reason: 'uncertain' });
          },
        }),
        fallback: {
          ...route({
            id: 'llm',
            supportedLayoutModes: ['grid'],
            async invoke({ context }) {
              context.calls.claim({ plannerId: 'llm', stage: 'initial' });
              return candidate();
            },
          }),
          on: ['deferred'],
        },
        operation: { timeoutMs: null, maxProviderCalls: budget },
      },
    });
    const result = await engine.handle(message());
    expect(result.ok).toBe(budget === 2);
    expect(
      events.filter(({ event }) => event === 'planning.fallback'),
    ).toHaveLength(budget === 2 ? 1 : 0);
    expect(
      events
        .filter(({ event }) => event === 'planning.provider_call')
        .map(({ data }) => ({
          plannerId: data?.plannerId,
          callNumber: data?.callNumber,
        })),
    ).toEqual(
      budget === 2
        ? [
            { plannerId: 'typesafe-jev', callNumber: 1 },
            { plannerId: 'llm', callNumber: 2 },
          ]
        : [{ plannerId: 'typesafe-jev', callNumber: 1 }],
    );
    expect(
      events.find(({ event }) => event === 'planning.completed'),
    ).toMatchObject({
      data: {
        plannerId: budget === 2 ? 'llm' : 'typesafe-jev',
        fallbackUsed: budget === 2,
        outcome: budget === 2 ? 'success' : 'error',
        providerCalls: budget,
        ...(budget === 1 ? { errorTag: 'PlanningBudgetExceededError' } : {}),
      },
    });
    if (budget === 2)
      expect(
        events.find(({ event }) => event === 'planning.fallback'),
      ).toMatchObject({
        data: {
          fromPlannerId: 'typesafe-jev',
          toPlannerId: 'llm',
          reason: 'deferred',
          messageId: 'logging-request',
        },
      });
  });

  test('records one terminal failure when a provider ignores the deadline', async () => {
    const { logger, events } = capture();
    const engine = createEngine({
      logger,
      planner: {
        primary: route({
          id: 'stalled',
          supportedLayoutModes: ['grid'],
          async invoke({ context }) {
            context.calls.claim({ plannerId: 'stalled', stage: 'initial' });
            return new Promise(() => {});
          },
        }),
        operation: { timeoutMs: 5, maxProviderCalls: 1 },
      },
    });
    expect((await engine.handle(message())).ok).toBe(false);
    const completed = events.filter(
      ({ event }) => event === 'planning.completed',
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      data: {
        plannerId: 'stalled',
        fallbackUsed: false,
        outcome: 'error',
        errorTag: 'TimeoutError',
        providerCalls: 1,
        messageId: 'logging-request',
      },
    });
  });
});
