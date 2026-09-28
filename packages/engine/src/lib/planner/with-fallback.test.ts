import { describe, expect, test } from 'bun:test';
import { err, isErr, isOk, ok } from '@maelstrom-co/protocol';

import { buildGridResponse } from '../__test-helpers__/fixtures.js';
import {
  makePlanningInput,
  makeStageContext,
  spyLogger,
} from '../__test-helpers__/stage-context.js';
import type { EngineError } from '../errors.js';
import {
  cancellationError,
  parseError,
  providerError,
  validationError,
} from '../errors.js';
import type {
  Planner,
  PlanningInput,
  StageContext,
  StageError,
} from './stage.js';
import { deferred } from './stage.js';
import { withFallback } from './with-fallback.js';

const primaryCandidate = buildGridResponse({ userMessage: 'from primary' });
const fallbackCandidate = buildGridResponse({ userMessage: 'from fallback' });

function recordingPlanner(
  outcome: 'candidate' | StageError,
  candidate = fallbackCandidate,
): {
  planner: Planner;
  calls: Array<{ input: PlanningInput; ctx: StageContext }>;
} {
  const calls: Array<{ input: PlanningInput; ctx: StageContext }> = [];
  const planner: Planner = async (input, ctx) => {
    calls.push({ input, ctx });
    return outcome === 'candidate' ? ok(candidate) : err(outcome);
  };
  return { planner, calls };
}

describe('withFallback', () => {
  test('a candidate from the primary ships and the fallback never runs', async () => {
    const primary = recordingPlanner('candidate', primaryCandidate);
    const fallback = recordingPlanner('candidate');

    const result = await withFallback(primary.planner, fallback.planner)(
      makePlanningInput(),
      makeStageContext(),
    );

    expect(isOk(result) && result.value).toBe(primaryCandidate);
    expect(fallback.calls).toHaveLength(0);
  });

  test.each([
    ['ProviderError', providerError('upstream', new Error('boom'))],
    ['ParseError', parseError('bad json', '{')],
    ['CancellationError', cancellationError('cancel', 'user')],
    ['ValidationError', validationError('bad', 'prompt')],
  ] as Array<
    [string, EngineError]
  >)('%s from the primary is returned without running the fallback', async (_, failure) => {
    const primary = recordingPlanner(failure);
    const fallback = recordingPlanner('candidate');

    const result = await withFallback(primary.planner, fallback.planner)(
      makePlanningInput(),
      makeStageContext(),
    );

    expect(isErr(result) && result.error).toBe(failure);
    expect(fallback.calls).toHaveLength(0);
  });

  test('a Deferred from the primary runs the fallback with the same input and context', async () => {
    const primary = recordingPlanner(deferred('scope unsupported'));
    const fallback = recordingPlanner('candidate');
    const { logger, entries } = spyLogger();
    const input = makePlanningInput();
    const ctx = makeStageContext({ origin: input, logger });

    const result = await withFallback(primary.planner, fallback.planner)(
      input,
      ctx,
    );

    expect(isOk(result) && result.value).toBe(fallbackCandidate);
    expect(fallback.calls).toHaveLength(1);
    expect(fallback.calls[0]?.input).toBe(input);
    expect(fallback.calls[0]?.ctx).toBe(ctx);
    expect(entries).toEqual([
      {
        level: 'info',
        msg: 'Planner stage deferred, running fallback',
        ctx: { messageId: input.messageId, reason: 'scope unsupported' },
      },
    ]);
  });

  test('a Deferred from the fallback propagates', async () => {
    const last = deferred('fallback also abstained');
    const result = await withFallback(
      recordingPlanner(deferred('first')).planner,
      recordingPlanner(last).planner,
    )(makePlanningInput(), makeStageContext());

    expect(isErr(result) && result.error).toBe(last);
  });

  test('nests: a chain of fallbacks tries each in order until one answers', async () => {
    const third = recordingPlanner('candidate');
    const result = await withFallback(
      recordingPlanner(deferred('a')).planner,
      withFallback(recordingPlanner(deferred('b')).planner, third.planner),
    )(makePlanningInput(), makeStageContext());

    expect(isOk(result) && result.value).toBe(fallbackCandidate);
    expect(third.calls).toHaveLength(1);
  });
});
