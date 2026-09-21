import { describe, expect, test } from 'bun:test';
import type { InstanceId } from '@maelstrom-co/protocol';
import { err, isErr, isOk, ok } from '@maelstrom-co/protocol';

import {
  buildGridResponse,
  makeGridRequest,
} from '../__test-helpers__/fixtures.js';
import {
  makePlanningInput,
  makeStageContext,
  spyLogger,
} from '../__test-helpers__/stage-context.js';
import { pipeline } from './pipeline.js';
import type {
  Planner,
  PlannerCandidate,
  PlanningInput,
  Retryable,
  Stage,
} from './stage.js';
import { deferred } from './stage.js';
import { withFallback } from './with-fallback.js';
import { withRetry } from './with-retry.js';

// A model-free experiment: layer 1 shortlists the instances whose Vessel the
// user named, layer 2 stacks them into a grid. The intermediate `Shortlist`
// type exists only here; the Engine never sees it.

interface Shortlist {
  readonly instanceIds: readonly InstanceId[];
  readonly width: number;
  readonly named: readonly string[];
}

const PREFERRED_WIDTH = 16;

const shortlistNamedVessels: Stage<
  Retryable<PlanningInput>,
  Shortlist
> = async (input) => {
  const { request } = input;
  const intent = request.context.updateReasons
    .flatMap((reason) => (reason.type === 'user_intent' ? [reason.intent] : []))
    .join(' ')
    .toLowerCase();
  const named = request.vessels.filter((vessel) =>
    intent.includes(vessel.name.toLowerCase()),
  );
  const instances = request.instances.filter((instance) =>
    named.some((vessel) => vessel.id === instance.vesselId),
  );
  if (instances.length === 0) {
    return err(deferred('the intent names no Vessel on the chart'));
  }
  const overflowed =
    input.retry?.diagnostics.droppedLayoutEntries.some(
      (drop) => drop.reason === 'position_overflow',
    ) ?? false;
  return ok({
    instanceIds: instances.map((instance) => instance.instanceId),
    width: overflowed
      ? request.context.chartDimensions.columns
      : PREFERRED_WIDTH,
    named: named.map((vessel) => vessel.name),
  });
};

const stackShortlist: Stage<Shortlist, PlannerCandidate> = async (
  shortlist,
  ctx,
) => {
  const height = Math.floor(
    ctx.origin.request.context.chartDimensions.rows /
      shortlist.instanceIds.length,
  );
  return ok({
    userMessage: `Showing ${shortlist.named.join(', ')}.`,
    rationale: 'Stacked the Vessels the intent named.',
    executionPlan: [],
    layout: {
      positions: shortlist.instanceIds.map((instanceId, index) => ({
        instanceId,
        position: { row: index * height, column: 0 },
        size: { width: shortlist.width, height },
      })),
    },
  });
};

const fallbackCandidate = buildGridResponse({ userMessage: 'fallback plan' });
const fallback: Planner = async () => ok(fallbackCandidate);

const unrelatedIntent = makeGridRequest({
  context: {
    updateReasons: [{ type: 'user_intent', intent: 'What is the weather?' }],
    chartDimensions: { columns: 12, rows: 8 },
    layoutMode: 'grid',
  },
});

describe('toy two-layer experiment', () => {
  test('the pipeline alone ships its first guess, which validation flags for retry', async () => {
    const ctx = makeStageContext();

    const result = await pipeline(shortlistNamedVessels, stackShortlist)(
      ctx.origin,
      ctx,
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const report = ctx.validate(result.value);
    expect(isOk(report) && report.value.diagnostics.retryHint).toEqual({
      severity: 'unrecoverable',
      recommend: true,
    });
  });

  test('withRetry feeds the diagnostics back through the pipeline and the second attempt validates clean', async () => {
    const { logger, entries } = spyLogger();
    const ctx = makeStageContext({ logger });

    const result = await withRetry(
      pipeline(shortlistNamedVessels, stackShortlist),
      { max: 1 },
    )(ctx.origin, ctx);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.layout).toEqual({
      positions: [
        {
          instanceId: ctx.origin.request.instances[0]!.instanceId,
          position: { row: 0, column: 0 },
          size: { width: 12, height: 8 },
        },
      ],
    });
    const report = ctx.validate(result.value);
    expect(isOk(report)).toBe(true);
    if (!isOk(report)) return;
    expect(report.value.diagnostics.droppedLayoutEntries).toEqual([]);
    expect(report.value.diagnostics.retryHint.recommend).toBe(false);
    expect(report.value.userMessage).toBe('Showing Calendar.');
    expect(entries.map((e) => e.msg)).toEqual([
      'Retrying after recommended retry',
      'Retry succeeded',
    ]);
  });

  test('withFallback runs the fallback when the experiment defers', async () => {
    const input = makePlanningInput(unrelatedIntent);
    let stacked = 0;
    const countingStack: Stage<Shortlist, PlannerCandidate> = async (
      shortlist,
      ctx,
    ) => {
      stacked += 1;
      return stackShortlist(shortlist, ctx);
    };

    const result = await withFallback(
      pipeline(shortlistNamedVessels, countingStack),
      fallback,
    )(input, makeStageContext({ origin: input }));

    expect(isOk(result) && result.value).toBe(fallbackCandidate);
    expect(stacked).toBe(0);
  });

  test('without a fallback the deferral reaches the caller as a value', async () => {
    const input = makePlanningInput(unrelatedIntent);

    const result = await pipeline(shortlistNamedVessels, stackShortlist)(
      input,
      makeStageContext({ origin: input }),
    );

    expect(isErr(result) && result.error).toEqual(
      deferred('the intent names no Vessel on the chart'),
    );
  });

  test('the full composition is an ordinary Planner', async () => {
    const planner: Planner = withFallback(
      withRetry(pipeline(shortlistNamedVessels, stackShortlist), { max: 1 }),
      fallback,
    );
    const ctx = makeStageContext();

    const result = await planner(ctx.origin, ctx);

    expect(isOk(result) && result.value.userMessage).toBe('Showing Calendar.');
  });
});
