import { describe, expect, mock, test } from 'bun:test';
import {
  ActionName,
  ChartRequestMessage,
  InstanceId,
  isErr,
  isOk,
  ok,
  SessionId,
  tilingLeafToken,
} from '@maelstrom-co/protocol';

import type { PlanValidationIssue, PlanValidator } from '../../index.js';
import {
  brandTilingResponse,
  buildGridResponse,
  invalid,
  makeGridRequest,
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import { createEngine } from '../engine.js';
import { createInMemoryStore } from '../history/in-memory-store.js';
import { validateEngineConfig } from '../validation/engine-config.js';
import type {
  ClarifyingPlanner,
  Planner,
  PlanningInput,
  Retryable,
} from './stage.js';
import { withRetry } from './with-retry.js';

const missingView: PlanValidationIssue = {
  code: 'required_view',
  message: 'Keep calendar-main visible in the layout.',
};

const requireCalendar: PlanValidator = ({ response }) => {
  const visible =
    response.layout.type === 'grid'
      ? response.layout.positions.some(
          ({ instanceId }) => instanceId === 'calendar-main',
        )
      : response.layout.tree.includes(
          tilingLeafToken(InstanceId('calendar-main')),
        );
  return visible ? [] : [missingView];
};

const gridMessage = () =>
  ChartRequestMessage({
    sessionId: SessionId('plan-validation'),
    request: makeGridRequest(),
  });

describe('application plan requirements', () => {
  test('feeds structured issues into the existing retry and ships only the repaired view', async () => {
    const seen: unknown[] = [];
    const planner: Planner = async (input: Retryable<PlanningInput>) => {
      seen.push(input.retry);
      if (input.retry === undefined) {
        return ok(buildGridResponse({ layout: { positions: [] } }));
      }
      expect(input.retry.diagnostics.planIssues).toEqual([missingView]);
      expect(input.retry.diagnostics.feedback).toContain(
        'Application requirements:',
      );
      expect(input.retry.diagnostics.feedback).toContain(missingView.message);
      return ok(buildGridResponse());
    };
    const validatePlan = mock(requireCalendar);
    const engine = createEngine({
      planner,
      validatePlan,
      logger: silentLogger,
    });
    const result = await engine.handle(gridMessage());
    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response') return;
    expect(result.value.response.layout).toEqual({
      type: 'grid',
      ...buildGridResponse().layout,
    });
    expect('diagnostics' in result.value.response).toBe(false);
    expect(seen).toHaveLength(2);
    expect(validatePlan).toHaveBeenCalledTimes(2);
  });

  test.each([
    false,
    { max: 0 },
    { max: 1 },
  ] as const)('never ships unmet requirements with retry policy %p or records them as successful history', async (retry) => {
    const planner = mock(async () => ok(buildGridResponse()));
    const store = createInMemoryStore();
    const engine = createEngine({
      planner,
      retry,
      logger: silentLogger,
      history: { store },
      validatePlan: () => [missingView],
    });
    const message = gridMessage();
    const result = await engine.handle(message);
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'validatePlan',
      cause: [missingView],
    });
    expect(planner).toHaveBeenCalledTimes(retry === false ? 1 : retry.max + 1);
    expect(await store.get(message.sessionId)).toEqual([]);
  });

  test('checks the original request and healed layout with only accepted Actions', async () => {
    const validatePlan = mock<PlanValidator>(({ request, response }) => {
      expect(request.vessels).toHaveLength(1);
      expect(response.layout).toEqual({
        type: 'grid',
        ...buildGridResponse().layout,
      });
      expect(response.executionPlan).toEqual([
        {
          instanceId: InstanceId('calendar-main'),
          action: ActionName('showWeek'),
        },
      ]);
      expect('diagnostics' in response).toBe(false);
      return [];
    });
    const engine = createEngine({
      retry: false,
      logger: silentLogger,
      validatePlan,
      planner: async (input, ctx) => {
        const narrowed = {
          ...input,
          request: { ...input.request, vessels: [] },
        };
        const stage: Planner = async () =>
          ok(
            buildGridResponse({
              layout: {
                positions: [
                  ...buildGridResponse().layout.positions,
                  {
                    instanceId: 'unknown',
                    position: { row: 0, column: 0 },
                    size: { width: 4, height: 4 },
                  },
                ],
              },
              executionPlan: [
                { instanceId: 'calendar-main', action: 'notAnAction' },
                { instanceId: 'calendar-main', action: 'showWeek' },
              ],
            }),
          );
        return stage(narrowed, ctx);
      },
    });
    expect(isOk(await engine.handle(gridMessage()))).toBe(true);
    expect(validatePlan).toHaveBeenCalledTimes(1);
  });

  test('a retained tiling Instance is not proof that its view is visible', async () => {
    const response = brandTilingResponse({
      userMessage: 'Calendar is visible.',
      rationale: 'Show calendar',
      executionPlan: [],
      layout: {
        tree: ['ID:other'],
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
          { instanceId: 'other', vesselId: 'calendar', variant: 'month' },
        ],
      },
    });
    const engine = createEngine({
      planner: async () => ok(response),
      validatePlan: requireCalendar,
      retry: false,
      logger: silentLogger,
    });
    const result = await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('hidden-view'),
        request: makeTilingRequest(),
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result))
      expect(result.error).toMatchObject({
        field: 'validatePlan',
        cause: [missingView],
      });
  });

  test('supports planners that own retries without multiplying the budget', async () => {
    const planner = mock<Planner>(async (input: Retryable<PlanningInput>) =>
      ok(buildGridResponse(input.retry ? {} : { layout: { positions: [] } })),
    );
    const engine = createEngine({
      planner: withRetry(planner, { max: 1 }),
      retry: false,
      validatePlan: requireCalendar,
      logger: silentLogger,
    });
    expect(isOk(await engine.handle(gridMessage()))).toBe(true);
    expect(planner).toHaveBeenCalledTimes(2);
  });

  test('validates a candidate once when stages and the final guard inspect it repeatedly', async () => {
    const validatePlan = mock<PlanValidator>(() => []);
    const candidate = buildGridResponse();
    const engine = createEngine({
      logger: silentLogger,
      validatePlan,
      planner: async (_input, ctx) => {
        expect(isOk(ctx.validate(candidate))).toBe(true);
        expect(isOk(ctx.validate(candidate))).toBe(true);
        return ok(candidate);
      },
    });
    expect(isOk(await engine.handle(gridMessage()))).toBe(true);
    expect(validatePlan).toHaveBeenCalledTimes(1);
    expect(isOk(await engine.handle(gridMessage()))).toBe(true);
    expect(validatePlan).toHaveBeenCalledTimes(2);
  });

  test('candidate diagnostics include application issues on cached validation without rerunning the hook', async () => {
    const validatePlan = mock<PlanValidator>(() => [missingView]);
    const candidate = buildGridResponse();
    const reports: unknown[] = [];
    const engine = createEngine({
      retry: false,
      logger: silentLogger,
      validatePlan,
      planner: async (_input, ctx) => {
        ctx.validate(candidate);
        ctx.validate(candidate);
        return ok(candidate);
      },
    });
    engine.observeDiagnostics?.((event, readContent) => {
      if (event.kind === 'engine.candidate.validated')
        reports.push(readContent?.());
    });

    const result = await engine.handle(gridMessage());

    expect(isErr(result)).toBe(true);
    expect(validatePlan).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(3);
    for (const report of reports) {
      expect(report).toMatchObject({
        ok: true,
        value: { diagnostics: { planIssues: [missingView] } },
      });
      expect(report).toBe(reports[0]);
    }
  });

  test.each([
    'missing',
    'blank',
    'clarification',
  ] as const)('keeps the delivery refusal for a %s reply without calling the application validator', async (outcome) => {
    const { userMessage: _reply, ...replyless } = buildGridResponse();
    const planner: ClarifyingPlanner = async () =>
      ok(
        outcome === 'clarification'
          ? { type: 'needs_clarification', question: 'Which calendar?' }
          : outcome === 'blank'
            ? { ...replyless, userMessage: ' ' }
            : replyless,
      );
    const validatePlan = mock<PlanValidator>(() => [missingView]);
    const engine = createEngine({
      planner,
      validatePlan,
      logger: silentLogger,
    });
    const result = await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('replyless-plan-validation'),
        request: { ...makeGridRequest(), skipReply: true },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: 'ValidationError', field: 'skipReply' },
    });
    expect(validatePlan).not.toHaveBeenCalled();
  });

  test('still checks application requirements for a complete response to a skipReply request', async () => {
    const validatePlan = mock<PlanValidator>(() => [missingView]);
    const engine = createEngine({
      planner: async () => ok(buildGridResponse()),
      retry: false,
      validatePlan,
      logger: silentLogger,
    });
    const result = await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('complete-plan-validation'),
        request: { ...makeGridRequest(), skipReply: true },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: 'ValidationError',
        field: 'validatePlan',
        cause: [missingView],
      },
    });
    expect(validatePlan).toHaveBeenCalledTimes(1);
  });

  test.each([
    () => {
      throw new Error('broken requirement check');
    },
    () => undefined,
    () => [{ code: '', message: 'missing code' }],
    () => [{ code: 'missing-message' }],
    async () => [],
    async () => {
      throw new Error('async requirement failure');
    },
  ])('fails closed without retrying a broken validator %#', async (validatePlan) => {
    const planner = mock(async () => ok(buildGridResponse()));
    const engine = createEngine({
      planner,
      logger: silentLogger,
      validatePlan: invalid<PlanValidator>(validatePlan),
    });
    const result = await engine.handle(gridMessage());
    expect(isErr(result)).toBe(true);
    if (isErr(result))
      expect(result.error).toMatchObject({
        _tag: 'ValidationError',
        field: 'validatePlan',
      });
    expect(planner).toHaveBeenCalledTimes(1);
  });

  test('a rejected cross-realm validator cannot crash the host process', () => {
    const probe = `
      import { runInNewContext } from 'node:vm';
      import { ChartRequestMessage, SessionId, ok } from '@maelstrom-co/protocol';
      import { createEngine } from '../engine.ts';
      import { buildGridResponse, makeGridRequest, silentLogger } from '../__test-helpers__/fixtures.ts';
      let attempts = 0;
      const engine = createEngine({
        logger: silentLogger,
        planner: async () => {
          attempts++;
          return ok(buildGridResponse());
        },
        validatePlan: () => runInNewContext('Promise.reject(new Error("broken hook"))'),
      });
      const result = await engine.handle(ChartRequestMessage({
        sessionId: SessionId('cross-realm-validator'),
        request: makeGridRequest(),
      }));
      if (result.ok || result.error._tag !== 'ValidationError' || result.error.field !== 'validatePlan')
        throw new Error('The broken validator must return a validation error');
      if (attempts !== 1) throw new Error('A broken validator must not retry');
      await new Promise(resolve => setTimeout(resolve, 10));
      console.log('validator rejected safely');
    `;
    const child = Bun.spawnSync(
      [process.execPath, '--no-env-file', '--eval', probe],
      { cwd: import.meta.dir, timeout: 5000 },
    );
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    expect(child.stdout.toString()).toContain('validator rejected safely');
  });

  test('rejects a non-callable hook at configuration time', () => {
    expect(() =>
      validateEngineConfig({
        planner: async () => ok(buildGridResponse()),
        validatePlan: [],
      }),
    ).toThrow('validatePlan');
  });
});
