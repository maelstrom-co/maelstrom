import { describe, expect, test } from 'bun:test';
import type { NeedsClarification, Result } from '@maelstrom-co/protocol';
import {
  ActionName,
  err,
  InstanceId,
  isErr,
  isOk,
  MessageId,
  ok,
} from '@maelstrom-co/protocol';

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
  historyError,
  parseError,
  providerError,
  timeoutError,
  validationError,
} from '../errors.js';
import type { Logger } from '../logger.js';
import type { SkippedAction } from '../response/execution-plan/index.js';
import { buildDiagnostics } from '../response/response-processor.js';
import type {
  DroppedLayoutEntry,
  RetryHint,
} from '../validation/llm-output/healed-layout.js';
import type {
  DiagnosticRecords,
  EngineDiagnostics,
  PlannerCandidate,
  PlannerOutput,
  ReplylessCandidate,
  ValidatedCandidate,
} from './candidate.js';
import type {
  PlanningInput,
  Retryable,
  Stage,
  StageContext,
  StageError,
} from './stage.js';
import { withRetry } from './with-retry.js';

// ---------------------------------------------------------------------------
// Fixtures: each attempt yields a distinct candidate object; a validation
// table maps it to the diagnostics the Engine validator would report.
// ---------------------------------------------------------------------------

const cleanHint: RetryHint = { severity: 'none', recommend: false };

const diagnostics = (
  input: Partial<DiagnosticRecords> = {},
): EngineDiagnostics =>
  buildDiagnostics({
    skippedActions: input.skippedActions ?? [],
    droppedLayoutEntries: input.droppedLayoutEntries ?? [],
    warnings: input.warnings ?? [],
    retryHint: input.retryHint ?? cleanHint,
  });

const recommending = (
  input: Omit<Partial<DiagnosticRecords>, 'retryHint'> & {
    severity?: 'medium' | 'unrecoverable';
  } = {},
): EngineDiagnostics => {
  const severity = input.severity ?? 'unrecoverable';
  const retryHint: RetryHint =
    severity === 'unrecoverable'
      ? { severity: 'unrecoverable', recommend: true }
      : { severity: 'medium', recommend: true };
  return diagnostics({ ...input, retryHint });
};

const overflowDrop = (id: string): DroppedLayoutEntry => ({
  reason: 'position_overflow',
  instanceId: InstanceId(id),
  row: 10,
  column: 5,
  width: 4,
  height: 3,
  chartColumns: 12,
  chartRows: 8,
});

const paramsParseFailed = (id: string, action: string): SkippedAction => ({
  reason: 'params_parse_failed',
  instanceId: InstanceId(id),
  action: ActionName(action),
});

type Attempt =
  | { readonly diagnostics: EngineDiagnostics }
  | { readonly error: StageError }
  | { readonly validationError: EngineError };

interface Recording {
  readonly stage: Stage<Retryable<PlanningInput>, PlannerCandidate>;
  readonly ctx: StageContext;
  readonly inputs: Retryable<PlanningInput>[];
  readonly contexts: StageContext[];
  readonly candidates: PlannerCandidate[];
  readonly validations: () => number;
}

function recordingStage(
  attempts: readonly Attempt[],
  options: { logger?: Logger; signal?: AbortSignal } = {},
): Recording {
  const inputs: Retryable<PlanningInput>[] = [];
  const contexts: StageContext[] = [];
  const candidates: PlannerCandidate[] = [];
  const table = new Map<
    ReplylessCandidate,
    Result<ValidatedCandidate, EngineError>
  >();
  let validations = 0;
  const stage: Stage<Retryable<PlanningInput>, PlannerCandidate> = async (
    input,
    ctx,
  ) => {
    const attempt = attempts[inputs.length];
    if (attempt === undefined) {
      throw new Error(
        `recordingStage: called ${inputs.length + 1} times, have ${attempts.length} attempts`,
      );
    }
    inputs.push(input);
    contexts.push(ctx);
    if ('error' in attempt) return err(attempt.error);
    const candidate = buildGridResponse({
      userMessage: `attempt ${inputs.length}`,
    });
    candidates.push(candidate);
    table.set(
      candidate,
      'validationError' in attempt
        ? err(attempt.validationError)
        : ok({
            type: 'maelstrom_response',
            requestId: MessageId('req-1'),
            userMessage: candidate.userMessage,
            rationale: candidate.rationale,
            executionPlan: [],
            layout: { type: 'grid', positions: [] },
            diagnostics: attempt.diagnostics,
          }),
    );
    return ok(candidate);
  };
  const ctx = makeStageContext({
    logger: options.logger,
    signal: options.signal,
    validate: (candidate) => {
      validations += 1;
      const result = table.get(candidate);
      if (result === undefined) throw new Error('unknown candidate');
      return result;
    },
  });
  return {
    stage,
    ctx,
    inputs,
    contexts,
    candidates,
    validations: () => validations,
  };
}

const clean: Attempt = { diagnostics: diagnostics() };
const overflow: Attempt = {
  diagnostics: recommending({ droppedLayoutEntries: [overflowDrop('a')] }),
};

describe('withRetry', () => {
  describe('success path (recommend=false)', () => {
    test('first-attempt success returns immediately, no retry, no Retry succeeded log', async () => {
      const { logger, entries } = spyLogger();
      const rec = recordingStage([clean], { logger });
      const input = makePlanningInput();

      const result = await withRetry(rec.stage, { max: 3 })(input, rec.ctx);

      expect(isOk(result) && result.value).toBe(rec.candidates[0]);
      expect(rec.inputs).toHaveLength(1);
      expect(rec.inputs[0]).toBe(input);
      expect(rec.inputs[0]?.retry).toBeUndefined();
      expect(entries).toEqual([]);
    });

    test('healed-but-not-recommended candidate ships without retry', async () => {
      const rec = recordingStage([
        {
          diagnostics: diagnostics({
            droppedLayoutEntries: [overflowDrop('a')],
            retryHint: { severity: 'medium', recommend: false },
          }),
        },
      ]);

      const result = await withRetry(rec.stage, { max: 3 })(
        makePlanningInput(),
        rec.ctx,
      );

      expect(isOk(result)).toBe(true);
      expect(rec.inputs).toHaveLength(1);
    });

    test('validates each candidate exactly once', async () => {
      const rec = recordingStage([overflow, clean]);

      await withRetry(rec.stage, { max: 3 })(makePlanningInput(), rec.ctx);

      expect(rec.validations()).toBe(2);
    });
  });

  describe('retry path (recommend=true)', () => {
    test('retries once on recommend=true, then ships the clean candidate', async () => {
      const rec = recordingStage([overflow, clean]);
      const input = makePlanningInput();

      const result = await withRetry(rec.stage, { max: 3 })(input, rec.ctx);

      expect(isOk(result) && result.value).toBe(rec.candidates[1]);
      expect(rec.inputs).toHaveLength(2);
      expect(rec.inputs[1]).toEqual({
        ...input,
        retry: {
          attempt: 1,
          previous: rec.candidates[0]!,
          diagnostics: (overflow as { diagnostics: EngineDiagnostics })
            .diagnostics,
        },
      });
    });

    test('retries keep the original input and carry only the latest feedback', async () => {
      const r1 = recommending({ droppedLayoutEntries: [overflowDrop('a')] });
      const r2 = recommending({
        skippedActions: [paramsParseFailed('b', 'go')],
        severity: 'medium',
      });
      const rec = recordingStage([
        { diagnostics: r1 },
        { diagnostics: r2 },
        clean,
      ]);
      const input = makePlanningInput();

      const result = await withRetry(rec.stage, { max: 3 })(input, rec.ctx);

      expect(isOk(result)).toBe(true);
      expect(rec.inputs).toHaveLength(3);
      expect(rec.inputs[1]?.retry).toEqual({
        attempt: 1,
        previous: rec.candidates[0]!,
        diagnostics: r1,
      });
      expect(rec.inputs[2]?.retry).toEqual({
        attempt: 2,
        previous: rec.candidates[1]!,
        diagnostics: r2,
      });
      for (const seen of rec.inputs) {
        expect(seen.request).toBe(input.request);
        expect(seen.history).toBe(input.history);
      }
    });
  });

  describe('fatal short-circuit (Err return path)', () => {
    test.each([
      ['ParseError', parseError('bad json', '{')],
      ['ProviderError', providerError('upstream', new Error('boom'))],
      ['CancellationError', cancellationError('cancel', 'user')],
      ['TimeoutError', timeoutError('slow', 5_000)],
      ['ValidationError', validationError('bad', 'prompt')],
      ['HistoryError', historyError.recordTurn('store', new Error('s'))],
    ] as Array<
      [string, EngineError]
    >)('%s from the stage is fatal: no retry', async (_, e) => {
      const rec = recordingStage([{ error: e }]);

      const result = await withRetry(rec.stage, { max: 3 })(
        makePlanningInput(),
        rec.ctx,
      );

      expect(isErr(result) && result.error).toBe(e);
      expect(rec.inputs).toHaveLength(1);
      expect(rec.validations()).toBe(0);
    });

    test('a Deferred from the stage is fatal: no retry', async () => {
      const deferral: StageError = { _tag: 'Deferred', reason: 'unsure' };
      const rec = recordingStage([{ error: deferral }]);

      const result = await withRetry(rec.stage, { max: 3 })(
        makePlanningInput(),
        rec.ctx,
      );

      expect(isErr(result) && result.error).toBe(deferral);
      expect(rec.inputs).toHaveLength(1);
    });

    test('a validation Err is fatal: no retry', async () => {
      const failure = parseError('LLM response missing userMessage', 'x');
      const rec = recordingStage([{ validationError: failure }]);

      const result = await withRetry(rec.stage, { max: 3 })(
        makePlanningInput(),
        rec.ctx,
      );

      expect(isErr(result) && result.error).toBe(failure);
      expect(rec.inputs).toHaveLength(1);
    });

    test('an Err after a recommended retry wins over the earlier candidate', async () => {
      const rec = recordingStage([
        overflow,
        { error: cancellationError('aborted', 'user') },
      ]);

      const result = await withRetry(rec.stage, { max: 3 })(
        makePlanningInput(),
        rec.ctx,
      );

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('CancellationError');
      expect(rec.inputs).toHaveLength(2);
    });
  });

  describe('signal forwarding', () => {
    test('every attempt receives the same context', async () => {
      const controller = new AbortController();
      const rec = recordingStage([overflow, overflow, clean], {
        signal: controller.signal,
      });

      await withRetry(rec.stage, { max: 3 })(makePlanningInput(), rec.ctx);

      expect(rec.contexts).toEqual([rec.ctx, rec.ctx, rec.ctx]);
      expect(rec.contexts[2]?.signal).toBe(controller.signal);
    });

    test('without a signal every attempt sees none', async () => {
      const rec = recordingStage([overflow, clean]);

      await withRetry(rec.stage, { max: 3 })(makePlanningInput(), rec.ctx);

      expect(rec.contexts.map((ctx) => ctx.signal)).toEqual([
        undefined,
        undefined,
      ]);
    });

    test('an abort after an attempt still runs the next attempt, whose Err ends the loop', async () => {
      const controller = new AbortController();
      let secondCallSawAborted = false;
      let calls = 0;
      const first = buildGridResponse();
      const stage: Stage<Retryable<PlanningInput>, PlannerCandidate> = async (
        _input,
        ctx,
      ) => {
        calls += 1;
        if (calls === 1) {
          controller.abort('mid-flight cancel');
          return ok(first);
        }
        if (ctx.signal?.aborted) {
          secondCallSawAborted = true;
          return err(
            cancellationError('aborted between attempts', ctx.signal.reason),
          );
        }
        return ok(buildGridResponse());
      };
      const ctx = makeStageContext({
        signal: controller.signal,
        validate: () =>
          ok({
            type: 'maelstrom_response',
            requestId: MessageId('req-1'),
            userMessage: 'x',
            rationale: 'y',
            executionPlan: [],
            layout: { type: 'grid', positions: [] },
            diagnostics: recommending(),
          }),
      });

      const result = await withRetry(stage, { max: 3 })(
        makePlanningInput(),
        ctx,
      );

      expect(secondCallSawAborted).toBe(true);
      expect(calls).toBe(2);
      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('CancellationError');
    });
  });

  describe('exhaustion', () => {
    test('every attempt recommends retry: ships the last candidate (Ok)', async () => {
      const rec = recordingStage([overflow, overflow, overflow]);

      const result = await withRetry(rec.stage, { max: 2 })(
        makePlanningInput(),
        rec.ctx,
      );

      expect(isOk(result) && result.value).toBe(rec.candidates[2]);
      expect(rec.inputs).toHaveLength(3);
    });

    test('exhaustion log routes severity to level and pins the full ctx shape', async () => {
      const { logger, entries } = spyLogger();
      const failed: Attempt = {
        diagnostics: recommending({
          skippedActions: [paramsParseFailed('a', 'go')],
          severity: 'medium',
        }),
      };
      const rec = recordingStage([failed, failed], { logger });

      await withRetry(rec.stage, { max: 1 })(makePlanningInput(), rec.ctx);

      const exhausted = entries.filter((e) => e.msg === 'Retries exhausted');
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]?.level).toBe('warn');
      expect(exhausted[0]?.ctx).toEqual({
        attempts: 2,
        retrySeverity: 'medium',
        droppedLayoutCount: 0,
        skippedActionCount: 1,
        warningCount: 0,
      });
    });

    test('exhaustion at unrecoverable severity logs at error level', async () => {
      const { logger, entries } = spyLogger();
      const rec = recordingStage([overflow, overflow], { logger });

      await withRetry(rec.stage, { max: 1 })(makePlanningInput(), rec.ctx);

      const exhausted = entries.filter((e) => e.msg === 'Retries exhausted');
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]?.level).toBe('error');
      expect(exhausted[0]?.ctx).toEqual({
        attempts: 2,
        retrySeverity: 'unrecoverable',
        droppedLayoutCount: 1,
        skippedActionCount: 0,
        warningCount: 0,
      });
    });
  });

  describe('configuration', () => {
    test('max=0 with recommend=true ships the first candidate, no retry attempt', async () => {
      const rec = recordingStage([overflow]);

      const result = await withRetry(rec.stage, { max: 0 })(
        makePlanningInput(),
        rec.ctx,
      );

      expect(isOk(result) && result.value).toBe(rec.candidates[0]);
      expect(rec.inputs).toHaveLength(1);
      expect(rec.inputs[0]?.retry).toBeUndefined();
    });

    test('max=0 with recommend=false is the same as not retrying', async () => {
      const rec = recordingStage([clean]);

      const result = await withRetry(rec.stage, { max: 0 })(
        makePlanningInput(),
        rec.ctx,
      );

      expect(isOk(result) && result.value).toBe(rec.candidates[0]);
      expect(rec.inputs).toHaveLength(1);
    });

    test('max=0 does not emit "Retries exhausted": nothing was retried', async () => {
      const { logger, entries } = spyLogger();
      const rec = recordingStage([overflow], { logger });

      await withRetry(rec.stage, { max: 0 })(makePlanningInput(), rec.ctx);

      expect(entries).toEqual([]);
    });

    test('max=1 caps at one retry (two total attempts)', async () => {
      const rec = recordingStage([overflow, overflow]);

      await withRetry(rec.stage, { max: 1 })(makePlanningInput(), rec.ctx);

      expect(rec.inputs).toHaveLength(2);
    });

    test('retry-attempt log pins the full ctx shape (severity-driven level)', async () => {
      const { logger, entries } = spyLogger();
      const rec = recordingStage(
        [
          {
            diagnostics: recommending({
              droppedLayoutEntries: [overflowDrop('a')],
              severity: 'medium',
            }),
          },
          clean,
        ],
        { logger },
      );

      await withRetry(rec.stage, { max: 3 })(makePlanningInput(), rec.ctx);

      expect(entries).toEqual([
        {
          level: 'warn',
          msg: 'Retrying after recommended retry',
          ctx: {
            attempt: 1,
            maxRetries: 3,
            retrySeverity: 'medium',
            droppedLayoutCount: 1,
            skippedActionCount: 0,
            warningCount: 0,
          },
        },
        {
          level: 'info',
          msg: 'Retry succeeded',
          ctx: { attempt: 1, maxRetries: 3 },
        },
      ]);
    });

    test.each([
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])('max=%p throws at construction', (max) => {
      const rec = recordingStage([]);
      expect(() => withRetry(rec.stage, { max })).toThrow(
        /withRetry: max must be a non-negative integer/,
      );
    });
  });
});

describe('withRetry with skipReply and intentFacts', () => {
  const skipReplyInput = (): PlanningInput =>
    makePlanningInput({
      ...makeGridRequest(),
      skipReply: true,
      intentFacts: { latestOrderSku: 'A123', similarSkus: ['B456'] },
    });

  test('skipReply and intentFacts reach the inner stage unchanged on the first attempt and on retries', async () => {
    const rec = recordingStage([overflow, clean]);
    const input = skipReplyInput();

    await withRetry(rec.stage, { max: 3 })(input, rec.ctx);

    expect(rec.inputs).toHaveLength(2);
    expect(rec.inputs[0]).toBe(input);
    expect(rec.inputs[1]?.request).toBe(input.request);
    expect(rec.inputs[1]?.request.skipReply).toBe(true);
    expect(rec.inputs[1]?.request.intentFacts).toBe(input.request.intentFacts);
  });

  test('a needs-clarification result comes back as the same object without a retry', async () => {
    const clarification: NeedsClarification = {
      type: 'needs_clarification',
      question: 'Which order do you mean?',
    };
    const input = skipReplyInput();
    let calls = 0;
    const stage: Stage<
      Retryable<PlanningInput, ReplylessCandidate>,
      PlannerOutput
    > = async () => {
      calls += 1;
      return ok(clarification);
    };
    let validations = 0;
    const severeRetry: ValidatedCandidate = {
      type: 'maelstrom_response',
      requestId: MessageId('req-1'),
      userMessage: 'unused',
      rationale: 'unused',
      executionPlan: [],
      layout: { type: 'grid', positions: [] },
      diagnostics: recommending(),
    };

    const result = await withRetry(stage, { max: 3 })(
      input,
      makeStageContext({
        origin: input,
        validate: () => {
          validations += 1;
          return ok(severeRetry);
        },
      }),
    );

    expect(isOk(result) && result.value).toBe(clarification);
    expect(validations).toBe(0);
    expect(calls).toBe(1);
  });

  test('a replyless candidate with skipReply comes back as the same object', async () => {
    const { userMessage: _omitted, ...candidate } = buildGridResponse();
    const input = skipReplyInput();
    let calls = 0;
    const stage: Stage<
      Retryable<PlanningInput, ReplylessCandidate>,
      ReplylessCandidate
    > = async () => {
      calls += 1;
      return ok(candidate);
    };

    const result = await withRetry(stage, { max: 3 })(
      input,
      makeStageContext({ origin: input }),
    );

    expect(isOk(result) && result.value).toBe(candidate);
    expect(calls).toBe(1);
  });
});
