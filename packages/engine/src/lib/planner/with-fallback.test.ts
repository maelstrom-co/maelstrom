import { describe, expect, test } from 'bun:test';
import type { NeedsClarification } from '@maelstrom-co/protocol';
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
import type { EngineError } from '../errors.js';
import {
  cancellationError,
  parseError,
  providerError,
  validationError,
} from '../errors.js';
import type { PlannerOutput } from './candidate.js';
import type {
  Planner,
  PlanningInput,
  Stage,
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

describe('withFallback with skipReply and intentFacts', () => {
  const skipReplyInput = (): PlanningInput =>
    makePlanningInput({
      ...makeGridRequest(),
      skipReply: true,
      intentFacts: { latestOrderSku: 'A123', similarSkus: ['B456'] },
    });

  const clarification: NeedsClarification = {
    type: 'needs_clarification',
    question: 'Which order do you mean?',
    options: ['The latest order'],
  };

  function recordingStage(outcome: PlannerOutput | StageError): {
    stage: Stage<PlanningInput, PlannerOutput>;
    inputs: PlanningInput[];
  } {
    const inputs: PlanningInput[] = [];
    const stage: Stage<PlanningInput, PlannerOutput> = async (input) => {
      inputs.push(input);
      return '_tag' in outcome ? err(outcome) : ok(outcome);
    };
    return { stage, inputs };
  }

  test('skipReply and intentFacts reach the primary and the fallback unchanged', async () => {
    const primary = recordingStage(deferred('not mine'));
    const fallback = recordingStage(fallbackCandidate);
    const input = skipReplyInput();

    await withFallback(primary.stage, fallback.stage)(
      input,
      makeStageContext({ origin: input }),
    );

    expect(primary.inputs).toEqual([input]);
    expect(primary.inputs[0]).toBe(input);
    expect(fallback.inputs[0]).toBe(input);
    expect(fallback.inputs[0]?.request.skipReply).toBe(true);
    expect(fallback.inputs[0]?.request.intentFacts).toBe(
      input.request.intentFacts,
    );
  });

  test('a needs-clarification result from the primary comes back as the same object', async () => {
    const fallback = recordingStage(fallbackCandidate);

    const result = await withFallback(
      recordingStage(clarification).stage,
      fallback.stage,
    )(skipReplyInput(), makeStageContext());

    expect(isOk(result) && result.value).toBe(clarification);
    expect(fallback.inputs).toHaveLength(0);
  });

  test('a needs-clarification result from the fallback comes back as the same object', async () => {
    const result = await withFallback(
      recordingStage(deferred('not mine')).stage,
      recordingStage(clarification).stage,
    )(skipReplyInput(), makeStageContext());

    expect(isOk(result) && result.value).toBe(clarification);
  });

  test('a replyless candidate comes back as the same object', async () => {
    const { userMessage: _omitted, ...candidate } = buildGridResponse();

    const result = await withFallback(
      recordingStage(candidate).stage,
      recordingStage(fallbackCandidate).stage,
    )(skipReplyInput(), makeStageContext());

    expect(isOk(result) && result.value).toBe(candidate);
  });
});
