import { describe, expect, test } from 'bun:test';
import { err, isErr, isOk, ok } from '@maelstrom-co/protocol';

import { buildGridResponse } from '../__test-helpers__/fixtures.js';
import {
  makePlanningInput,
  makeStageContext,
  spyLogger,
} from '../__test-helpers__/stage-context.js';
import { cancellationError, providerError } from '../errors.js';
import type { PlannerCandidate } from './candidate.js';
import type { Instrument } from './instrument.js';
import { named } from './instrument.js';
import { pipeline } from './pipeline.js';
import type { PlanningInput, Stage, StageContext } from './stage.js';
import { deferred } from './stage.js';

const candidate = buildGridResponse();

describe('pipeline', () => {
  test('threads each output into the next stage and returns the last output', async () => {
    const seen: unknown[] = [];
    const contexts: StageContext[] = [];
    const first: Stage<PlanningInput, number> = async (input, ctx) => {
      seen.push(input);
      contexts.push(ctx);
      return ok(1);
    };
    const second: Stage<number, string> = async (input, ctx) => {
      seen.push(input);
      contexts.push(ctx);
      return ok(`n=${input}`);
    };
    const third: Stage<string, PlannerCandidate> = async (input, ctx) => {
      seen.push(input);
      contexts.push(ctx);
      return ok(candidate);
    };
    const input = makePlanningInput();
    const ctx = makeStageContext({ origin: input });

    const result = await pipeline(first, second, third)(input, ctx);

    expect(isOk(result) && result.value).toBe(candidate);
    expect(seen).toEqual([input, 1, 'n=1']);
    expect(contexts).toEqual([ctx, ctx, ctx]);
  });

  test('a single stage runs unchanged', async () => {
    const planner: Stage<PlanningInput, PlannerCandidate> = async () =>
      ok(candidate);

    const result = await pipeline(planner)(
      makePlanningInput(),
      makeStageContext(),
    );

    expect(isOk(result) && result.value).toBe(candidate);
  });

  test('a Deferred stops the pipeline and is returned as-is', async () => {
    const deferral = deferred('no vessel matched');
    let laterCalls = 0;
    const first: Stage<PlanningInput, string> = async () => err(deferral);
    const second: Stage<string, PlannerCandidate> = async () => {
      laterCalls += 1;
      return ok(candidate);
    };
    const result = await pipeline(first, second)(
      makePlanningInput(),
      makeStageContext(),
    );

    expect(isErr(result) && result.error).toBe(deferral);
    expect(laterCalls).toBe(0);
  });

  test('an EngineError stops the pipeline and is returned as-is', async () => {
    const failure = providerError('upstream', new Error('boom'));
    let laterCalls = 0;
    const first: Stage<PlanningInput, string> = async () => err(failure);
    const second: Stage<string, PlannerCandidate> = async () => {
      laterCalls += 1;
      return ok(candidate);
    };
    const result = await pipeline(first, second)(
      makePlanningInput(),
      makeStageContext(),
    );

    expect(isErr(result) && result.error).toBe(failure);
    expect(laterCalls).toBe(0);
  });

  test('an abort between stages returns CancellationError without running the next stage', async () => {
    const controller = new AbortController();
    const { logger, entries } = spyLogger();
    let laterCalls = 0;
    const result = await pipeline(
      async (_input: PlanningInput) => {
        controller.abort('user left');
        return ok('selection');
      },
      async (_input: string) => {
        laterCalls += 1;
        return ok(candidate);
      },
    )(
      makePlanningInput(),
      makeStageContext({ signal: controller.signal, logger }),
    );

    expect(laterCalls).toBe(0);
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('CancellationError');
    expect(result.error).toMatchObject({ reason: 'user left' });
    expect(entries).toEqual([
      {
        level: 'info',
        msg: 'Request cancelled',
        ctx: { messageId: makePlanningInput().messageId, reason: 'user left' },
      },
    ]);
  });

  test('does not pre-check the signal before the first stage', async () => {
    const controller = new AbortController();
    controller.abort('early');
    const own = cancellationError('stage saw abort', 'early');
    let calls = 0;
    const result = await pipeline(async (_input: PlanningInput) => {
      calls += 1;
      return err(own);
    })(makePlanningInput(), makeStageContext({ signal: controller.signal }));

    expect(calls).toBe(1);
    expect(isErr(result) && result.error).toBe(own);
  });

  test('accepts nine stages', async () => {
    const step: Stage<number, number> = async (n) => ok(n + 1);
    const result = await pipeline(
      async (_input: PlanningInput) => ok(0),
      step,
      step,
      step,
      step,
      step,
      step,
      step,
      async (n: number) =>
        ok(buildGridResponse({ userMessage: `after ${n} steps` })),
    )(makePlanningInput(), makeStageContext());

    expect(isOk(result) && result.value.userMessage).toBe('after 7 steps');
  });

  describe('instrumentation', () => {
    function spyInstrument(): { instrument: Instrument; names: string[] } {
      const names: string[] = [];
      return {
        names,
        instrument: {
          stage: (name, stage) => {
            names.push(name);
            return stage;
          },
          event: () => undefined,
        },
      };
    }

    test('wraps each stage in order under its name, or its index when unnamed', async () => {
      const { instrument, names } = spyInstrument();
      const planner = pipeline(
        named('select', async (_input: PlanningInput) => ok(1)),
        async (n: number) => ok(n + 1),
        named('layout', async (n: number) =>
          ok(buildGridResponse({ userMessage: `n=${n}` })),
        ),
      );

      const result = await planner(
        makePlanningInput(),
        makeStageContext({ instrument }),
      );

      expect(isOk(result) && result.value.userMessage).toBe('n=2');
      expect(names).toEqual(['select', 'stage-1', 'layout']);
    });

    test('wraps the stages again on every request', async () => {
      const { instrument, names } = spyInstrument();
      const planner = pipeline(
        named('only', async (_input: PlanningInput) => ok(candidate)),
      );
      const ctx = makeStageContext({ instrument });

      await planner(makePlanningInput(), ctx);
      await planner(makePlanningInput(), ctx);

      expect(names).toEqual(['only', 'only']);
    });

    test('runs the stage the instrument returns instead of the original', async () => {
      let originalCalls = 0;
      const replayed = buildGridResponse({ userMessage: 'replayed' });
      const replaying: Instrument = {
        stage: <In, Out>(name: string, stage: Stage<In, Out>) =>
          name === 'layout'
            ? ((async () => ok(replayed)) as unknown as Stage<In, Out>)
            : stage,
        event: () => undefined,
      };
      const planner = pipeline(
        async (_input: PlanningInput) => ok('selection'),
        named('layout', async (_input: string) => {
          originalCalls += 1;
          return ok(candidate);
        }),
      );

      const result = await planner(
        makePlanningInput(),
        makeStageContext({ instrument: replaying }),
      );

      expect(isOk(result) && result.value).toBe(replayed);
      expect(originalCalls).toBe(0);
    });

    test('the default instrument leaves results identical', async () => {
      const planner = pipeline(
        named('select', async (_input: PlanningInput) => ok('selection')),
        async (_input: string) => ok(candidate),
      );

      const result = await planner(makePlanningInput(), makeStageContext());

      expect(isOk(result) && result.value).toBe(candidate);
    });

    test('cancellation between stages still short-circuits', async () => {
      const { instrument, names } = spyInstrument();
      const controller = new AbortController();
      const result = await pipeline(
        named('select', async (_input: PlanningInput) => {
          controller.abort('user left');
          return ok('selection');
        }),
        named('layout', async (_input: string) => ok(candidate)),
      )(
        makePlanningInput(),
        makeStageContext({ instrument, signal: controller.signal }),
      );

      expect(isErr(result) && result.error._tag).toBe('CancellationError');
      expect(names).toEqual(['select']);
    });
  });
});
