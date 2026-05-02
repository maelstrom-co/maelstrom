import { describe, expect, test } from 'bun:test';
import type {
  ActionName,
  Result,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { InstanceId, err, isErr, isOk, ok, MessageId } from '@maelstrom-co/protocol';

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
import { silentLogger } from '../__test-helpers__/fixtures.js';
import type { SkippedAction } from '../response/execution-plan/index.js';
import type { InternalResponse } from '../response/response-processor.js';
import type {
  DroppedLayoutEntry,
  RetryHint,
} from '../validation/llm-output/healed-layout.js';

import { buildRetryPrompt, callWithRetry, type RunOnce } from './retry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface DiagnosticsInput {
  skippedActions?: readonly SkippedAction[];
  droppedLayoutEntries?: readonly DroppedLayoutEntry[];
  warnings?: readonly { kind: 'missing_rationale' }[];
  retryHint?: RetryHint;
}

const cleanHint: RetryHint = { severity: 'none', recommend: false };

const response = (input: DiagnosticsInput = {}): InternalResponse => ({
  type: 'maelstrom_response',
  requestId: MessageId('req-1'),
  userMessage: 'ok',
  rationale: 'because',
  executionPlan: [],
  layout: { type: 'grid', positions: [] },
  diagnostics: {
    skippedActions: input.skippedActions ?? [],
    droppedLayoutEntries: input.droppedLayoutEntries ?? [],
    warnings: input.warnings ?? [],
    retryHint: input.retryHint ?? cleanHint,
  },
});

const recommendingResponse = (
  input: Omit<DiagnosticsInput, 'retryHint'> & {
    severity?: 'medium' | 'unrecoverable';
  } = {},
): InternalResponse => {
  const severity = input.severity ?? 'unrecoverable';
  const hint: RetryHint =
    severity === 'unrecoverable'
      ? { severity: 'unrecoverable', recommend: true }
      : { severity: 'medium', recommend: true };
  return response({ ...input, retryHint: hint });
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

const paramsParseFailed = (
  id: string,
  action: string,
  paramsJson: string,
): SkippedAction => ({
  reason: 'params_parse_failed',
  instanceId: InstanceId(id),
  action: action as ActionName,
  paramsJson,
});

const stateDrift = (id: string, action: string): SkippedAction => ({
  reason: 'state_drift',
  instanceId: InstanceId(id),
  action: action as ActionName,
  vesselId: 'v' as VesselId,
  targetVariant: 'gone' as VariantName,
});

function recordingRunOnce(
  sequence: readonly Result<InternalResponse, EngineError>[],
): {
  runOnce: RunOnce;
  prompts: string[];
  signals: Array<AbortSignal | undefined>;
  calls: () => number;
} {
  const prompts: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  let i = 0;
  const runOnce: RunOnce = async (userPrompt, signal) => {
    if (i >= sequence.length) {
      throw new Error(
        `recordingRunOnce: called ${i + 1} times, sequence has ${sequence.length}`,
      );
    }
    prompts.push(userPrompt);
    signals.push(signal);
    const r = sequence[i];
    i += 1;
    if (r === undefined) {
      throw new Error(`recordingRunOnce: missing result at index ${i - 1}`);
    }
    return r;
  };
  return { runOnce, prompts, signals, calls: () => i };
}

interface SpyEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  error?: unknown;
  ctx?: Record<string, unknown>;
}

function spyLogger(): { logger: Logger; entries: SpyEntry[] } {
  const entries: SpyEntry[] = [];
  const logger: Logger = {
    debug: (msg, ctx) => entries.push({ level: 'debug', msg, ctx }),
    info: (msg, ctx) => entries.push({ level: 'info', msg, ctx }),
    warn: (msg, ctx) => entries.push({ level: 'warn', msg, ctx }),
    error: (msg, error, ctx) =>
      entries.push({ level: 'error', msg, error, ctx }),
  };
  return { logger, entries };
}

// ---------------------------------------------------------------------------
// callWithRetry
// ---------------------------------------------------------------------------

describe('callWithRetry', () => {
  describe('success path (recommend=false)', () => {
    test('first-attempt success returns immediately, no retry, no Retry succeeded log', async () => {
      const r = response();
      const { logger, entries } = spyLogger();
      const { runOnce, prompts, calls } = recordingRunOnce([ok(r)]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'do the thing',
        maxRetries: 3,
        logger,
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value).toBe(r);
      expect(calls()).toBe(1);
      expect(prompts).toEqual(['do the thing']);
      // The `if (attempt > 0)` guard around `Retry succeeded` is the only
      // thing keeping clean calls quiet — pin it so a future refactor that
      // drops the guard fires the log on every clean call.
      expect(
        entries.filter((e) => e.msg === 'Retry succeeded'),
      ).toHaveLength(0);
    });

    test('healed-but-not-recommended response ships without retry', async () => {
      // Heal absorbed a single drop; retryHint.recommend stayed false because
      // some layout survived. The retry layer must not fire.
      const r = response({
        droppedLayoutEntries: [overflowDrop('a')],
        retryHint: { severity: 'medium', recommend: false },
      });
      const { runOnce, calls } = recordingRunOnce([ok(r)]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 3,
        logger: silentLogger,
      });

      expect(isOk(result)).toBe(true);
      expect(calls()).toBe(1);
    });

    test('state_drift-only skipped actions ship without retry (recommend=false)', async () => {
      // recommend is false because anySkipFixable is false. Pin the contract
      // so a future broadening of the retry trigger can't sneak drift skips
      // into a re-prompt loop they can't fix.
      const r = response({
        skippedActions: [stateDrift('a', 'go')],
        retryHint: { severity: 'medium', recommend: false },
      });
      const { runOnce, calls } = recordingRunOnce([ok(r)]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 3,
        logger: silentLogger,
      });

      expect(isOk(result)).toBe(true);
      expect(calls()).toBe(1);
    });
  });

  describe('retry path (recommend=true)', () => {
    test('retries once on recommend=true then succeeds', async () => {
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      const succeeded = response();
      const { runOnce, prompts, calls } = recordingRunOnce([
        ok(failed),
        ok(succeeded),
      ]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'do the thing',
        maxRetries: 3,
        logger: silentLogger,
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value).toBe(succeeded);
      expect(calls()).toBe(2);
      expect(prompts[0]).toBe('do the thing');
      expect(prompts[1]).toContain('previous response had issues');
      expect(prompts[1]).toContain('do the thing');
      expect(prompts[1]).toContain(
        'instance "a" at (10,5) size 4x3 exceeds chart bounds (12x8)',
      );
    });

    test('retry prompt reproduces the original user prompt verbatim', async () => {
      const original =
        'Make the chart show three panels: \n  - top: orders\n  - middle: trades\n  - bottom: positions';
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      const { runOnce, prompts } = recordingRunOnce([
        ok(failed),
        ok(response()),
      ]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: original,
        maxRetries: 1,
        logger: silentLogger,
      });

      expect(prompts[1]).toContain('Original request:');
      expect(prompts[1]?.endsWith(original)).toBe(true);
    });

    test('retry prompt suppresses state_drift skipped actions', async () => {
      const failed = recommendingResponse({
        skippedActions: [
          paramsParseFailed('a', 'go', '{bad'),
          stateDrift('b', 'wander'),
        ],
        severity: 'medium',
      });
      const { runOnce, prompts } = recordingRunOnce([
        ok(failed),
        ok(response()),
      ]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 1,
        logger: silentLogger,
      });

      expect(prompts[1]).toContain(
        'Action "go" on instance "a" had unparseable params',
      );
      expect(prompts[1]).not.toContain('"b"');
      expect(prompts[1]).not.toContain('wander');
    });

    test('retry prompt collapses every tree_* drop into a single advisory line', async () => {
      const failed = recommendingResponse({
        droppedLayoutEntries: [
          { reason: 'tree_missing_child', atTokenIndex: 3 },
          {
            reason: 'tree_orphan_reference',
            atTokenIndex: 5,
            instanceId: InstanceId('lost'),
          },
          { reason: 'tree_extra_tokens', fromTokenIndex: 10, count: 2 },
        ],
      });
      const { runOnce, prompts } = recordingRunOnce([
        ok(failed),
        ok(response()),
      ]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 1,
        logger: silentLogger,
      });

      expect(prompts[1]).toContain(
        'tiling tree was malformed and could not be fully parsed',
      );
      // Token-position fields must not leak — they mean nothing to the LLM.
      expect(prompts[1]).not.toMatch(/atTokenIndex|fromTokenIndex|token index/);
      // No per-drop tree line should survive.
      const treeLines = prompts[1]
        ?.split('\n')
        .filter((l) => /tiling tree/i.test(l));
      expect(treeLines).toHaveLength(1);
    });

    test('retry prompt mixes per-instance drops with the tree advisory', async () => {
      // Mixed-drop coverage: a future refactor that early-returns on hitting
      // a tree drop would silently strip per-instance drops; this test would
      // fail on the missing per-instance line.
      const failed = recommendingResponse({
        droppedLayoutEntries: [
          overflowDrop('a'),
          { reason: 'tree_missing_child', atTokenIndex: 7 },
        ],
      });
      const { runOnce, prompts } = recordingRunOnce([
        ok(failed),
        ok(response()),
      ]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 1,
        logger: silentLogger,
      });

      expect(prompts[1]).toContain('exceeds chart bounds');
      expect(prompts[1]).toContain(
        'tiling tree was malformed and could not be fully parsed',
      );
      const treeLines = prompts[1]
        ?.split('\n')
        .filter((l) => /tiling tree/i.test(l));
      expect(treeLines).toHaveLength(1);
    });

    test('mixed retryable failures across multiple retries', async () => {
      const r1 = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      const r2 = recommendingResponse({
        skippedActions: [paramsParseFailed('b', 'go', '{x')],
        severity: 'medium',
      });
      const { runOnce, prompts, calls } = recordingRunOnce([
        ok(r1),
        ok(r2),
        ok(response()),
      ]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 3,
        logger: silentLogger,
      });

      expect(isOk(result)).toBe(true);
      expect(calls()).toBe(3);
      // Prompt 1: built from r1 (overflow only)
      expect(prompts[1]).toContain('exceeds chart bounds');
      expect(prompts[1]).not.toContain('unparseable params');
      // Prompt 2: built from r2 (params only)
      expect(prompts[2]).toContain('unparseable params');
      expect(prompts[2]).not.toContain('exceeds chart bounds');
    });
  });

  describe('fatal short-circuit (Err return path)', () => {
    test.each([
      ['ParseError', parseError('bad json', '{')],
      ['ProviderError', providerError('upstream', new Error('boom'))],
      ['CancellationError', cancellationError('cancel', 'user')],
      ['TimeoutError', timeoutError('slow', 5_000)],
      ['ValidationError', validationError('bad', 'prompt')],
      ['HistoryError', historyError('store', 'record_turn', new Error('s'))],
    ] as Array<[string, EngineError]>)('%s is fatal — no retry', async (_, e) => {
      const { runOnce, calls } = recordingRunOnce([err(e)]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 3,
        logger: silentLogger,
      });

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe(e._tag);
      expect(calls()).toBe(1);
    });

    test('CancellationError mid-retry sequence propagates immediately', async () => {
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      const { runOnce, calls } = recordingRunOnce([
        ok(failed),
        err(cancellationError('aborted', 'user')),
      ]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 3,
        logger: silentLogger,
      });

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('CancellationError');
      expect(calls()).toBe(2);
    });
  });

  describe('signal forwarding', () => {
    test('forwards the same signal to every attempt', async () => {
      const controller = new AbortController();
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      const { runOnce, signals } = recordingRunOnce([
        ok(failed),
        ok(failed),
        ok(response()),
      ]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 3,
        logger: silentLogger,
        signal: controller.signal,
      });

      expect(signals).toHaveLength(3);
      for (const s of signals) {
        expect(s).toBe(controller.signal);
      }
    });

    test('forwards undefined when no signal configured', async () => {
      const { runOnce, signals } = recordingRunOnce([ok(response())]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 3,
        logger: silentLogger,
      });

      expect(signals).toEqual([undefined]);
    });

    test('signal observed by a later attempt after a prior abort propagates as CancellationError', async () => {
      // Real abort-flow coverage: the first attempt aborts the controller;
      // the second attempt observes `signal.aborted === true` and returns
      // `cancellationError`. callWithRetry surfaces it as fatal Err. Pins the
      // signal-propagation contract that hardcoding an Err on attempt N
      // alone does not exercise.
      const controller = new AbortController();
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      let secondCallSawAborted = false;

      let attemptIndex = 0;
      const runOnce: RunOnce = async (_userPrompt, signal) => {
        if (attemptIndex === 0) {
          attemptIndex += 1;
          controller.abort('mid-flight cancel');
          return ok(failed);
        }
        attemptIndex += 1;
        if (signal?.aborted) {
          secondCallSawAborted = true;
          return err(
            cancellationError(
              'aborted between attempts',
              signal.reason ?? 'unknown',
            ),
          );
        }
        return ok(response());
      };

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 3,
        logger: silentLogger,
        signal: controller.signal,
      });

      expect(secondCallSawAborted).toBe(true);
      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error._tag).toBe('CancellationError');
      expect(attemptIndex).toBe(2);
    });
  });

  describe('exhaustion', () => {
    test('every attempt recommends retry → ships the last response (Ok)', async () => {
      // Heal guarantees every Ok is renderable; exhaustion does not become
      // an Err — the user sees a degraded UI rather than a blocked turn.
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      const last = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('b')],
      });
      const { runOnce, calls } = recordingRunOnce([
        ok(failed),
        ok(failed),
        ok(last),
      ]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 2,
        logger: silentLogger,
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value).toBe(last);
      expect(calls()).toBe(3);
    });

    test('exhaustion log routes severity → level and pins full ctx shape', async () => {
      // Severity-driven log routing: 'medium' → warn, 'unrecoverable' → error,
      // others → info. Exhaustion ctx pins every key so a future log-shape
      // regression (extra fields, missing fields) fails the assertion.
      const failed = recommendingResponse({
        skippedActions: [paramsParseFailed('a', 'go', '{bad')],
        severity: 'medium',
      });
      const { logger, entries } = spyLogger();
      const { runOnce } = recordingRunOnce([ok(failed), ok(failed)]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 1,
        logger,
      });

      const exhausted = entries.filter((e) => e.msg === 'Retries exhausted');
      expect(exhausted).toHaveLength(1);
      const entry = exhausted[0];
      expect(entry?.level).toBe('warn');
      expect(entry?.ctx).toEqual({
        attempts: 2,
        retrySeverity: 'medium',
        droppedLayoutCount: 0,
        skippedActionCount: 1,
        warningCount: 0,
      });
    });

    test('exhaustion at unrecoverable severity logs at error level with full ctx pinned', async () => {
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
        severity: 'unrecoverable',
      });
      const { logger, entries } = spyLogger();
      const { runOnce } = recordingRunOnce([ok(failed), ok(failed)]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 1,
        logger,
      });

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
    test('maxRetries=0 with recommend=true ships the first response, no retry attempt', async () => {
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      const { runOnce, calls, prompts } = recordingRunOnce([ok(failed)]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 0,
        logger: silentLogger,
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value).toBe(failed);
      expect(calls()).toBe(1);
      expect(prompts).toEqual(['p']);
    });

    test('maxRetries=0 with recommend=false is the same as not retrying', async () => {
      const r = response();
      const { runOnce, calls } = recordingRunOnce([ok(r)]);

      const result = await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 0,
        logger: silentLogger,
      });

      expect(isOk(result)).toBe(true);
      expect(calls()).toBe(1);
    });

    test('maxRetries=0 does not emit "Retries exhausted" — nothing was retried', async () => {
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      const { logger, entries } = spyLogger();
      const { runOnce } = recordingRunOnce([ok(failed)]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 0,
        logger,
      });

      expect(entries.filter((e) => e.msg === 'Retries exhausted')).toHaveLength(
        0,
      );
    });

    test('maxRetries=1 caps at one retry (two total attempts)', async () => {
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
      });
      const { runOnce, calls } = recordingRunOnce([ok(failed), ok(failed)]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 1,
        logger: silentLogger,
      });

      expect(calls()).toBe(2);
    });

    test('retry-attempt log pins the full ctx shape (severity-driven level)', async () => {
      const failed = recommendingResponse({
        droppedLayoutEntries: [overflowDrop('a')],
        severity: 'medium',
      });
      const { logger, entries } = spyLogger();
      const { runOnce } = recordingRunOnce([ok(failed), ok(response())]);

      await callWithRetry({
        runOnce,
        originalUserPrompt: 'p',
        maxRetries: 3,
        logger,
      });

      const retrying = entries.filter(
        (e) => e.msg === 'Retrying after recommended retry',
      );
      expect(retrying).toHaveLength(1);
      const entry = retrying[0];
      expect(entry?.level).toBe('warn');
      expect(entry?.ctx).toEqual({
        attempt: 1,
        maxRetries: 3,
        retrySeverity: 'medium',
        droppedLayoutCount: 1,
        skippedActionCount: 0,
        warningCount: 0,
      });

      const succeeded = entries.filter((e) => e.msg === 'Retry succeeded');
      expect(succeeded).toHaveLength(1);
      expect(succeeded[0]?.level).toBe('info');
      expect(succeeded[0]?.ctx).toEqual({ attempt: 1, maxRetries: 3 });
    });
  });
});

// ---------------------------------------------------------------------------
// buildRetryPrompt — direct format pinning
// ---------------------------------------------------------------------------

const recommendUnrecoverable: RetryHint = {
  severity: 'unrecoverable',
  recommend: true,
};
const recommendMedium: RetryHint = { severity: 'medium', recommend: true };

describe('buildRetryPrompt', () => {
  test('no diagnostics → only the header + original prompt', () => {
    const out = buildRetryPrompt('original', {
      skippedActions: [],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: recommendUnrecoverable,
    });

    expect(out).toBe(
      [
        'The previous response had issues. Please re-issue the response addressing:',
        '',
        'Original request:',
        'original',
      ].join('\n'),
    );
  });

  test('layout drops and skipped actions appear in their own sections', () => {
    const out = buildRetryPrompt('orig', {
      skippedActions: [paramsParseFailed('b', 'doIt', '{x')],
      droppedLayoutEntries: [overflowDrop('a')],
      warnings: [],
      retryHint: recommendMedium,
    });

    expect(out).toContain('Layout drops:');
    expect(out).toContain('Skipped actions:');
    expect(out).toContain(
      'instance "a" at (10,5) size 4x3 exceeds chart bounds (12x8)',
    );
    expect(out).toContain(
      'Action "doIt" on instance "b" had unparseable params: {x',
    );
    expect(out).toContain('orig');
  });

  // Pin every per-instance DroppedLayoutEntry formatter via the shared
  // formatDroppedEntry helper. Tree drops are tested separately above
  // (collapse to single advisory).
  test.each([
    [
      { reason: 'unknown_instance' as const, instanceId: InstanceId('ghost') },
      'instance "ghost" not in request',
    ],
    [
      {
        reason: 'unknown_vessel' as const,
        instanceId: InstanceId('orphan'),
        vesselId: 'no-such' as VesselId,
      },
      'instance "orphan" referenced unknown vessel "no-such"',
    ],
    [
      {
        reason: 'unknown_variant' as const,
        instanceId: InstanceId('wgt'),
        variant: 'gone' as VariantName,
      },
      'instance "wgt" referenced unknown variant "gone"',
    ],
    [
      {
        reason: 'position_overflow' as const,
        instanceId: InstanceId('a'),
        row: 10,
        column: 5,
        width: 4,
        height: 3,
        chartColumns: 12,
        chartRows: 8,
      },
      'instance "a" at (10,5) size 4x3 exceeds chart bounds (12x8)',
    ],
    [
      {
        reason: 'size_below_minimum' as const,
        instanceId: InstanceId('small'),
        width: 1,
        height: 1,
        minWidth: 4,
        minHeight: 3,
      },
      'instance "small" size 1x1 below variant minimum 4x3',
    ],
    [
      {
        reason: 'duplicate_instance_id' as const,
        instanceId: InstanceId('dupe'),
      },
      'instance "dupe" appeared multiple times in layout',
    ],
  ] satisfies Array<[DroppedLayoutEntry, string]>)(
    'formats DroppedLayoutEntry %p',
    (drop, expected) => {
      const out = buildRetryPrompt('orig', {
        skippedActions: [],
        droppedLayoutEntries: [drop],
        warnings: [],
        retryHint: recommendMedium,
      });
      expect(out).toContain(`- ${expected}`);
    },
  );

  // Pin every non-state_drift SkippedAction formatter.
  test.each([
    [
      paramsParseFailed('a', 'go', '{bad'),
      'Action "go" on instance "a" had unparseable params: {bad',
    ],
    [
      {
        reason: 'unknown_instance' as const,
        instanceId: InstanceId('ghost'),
        action: 'tap' as ActionName,
      },
      'Action "tap" referenced unknown instance "ghost"',
    ],
    [
      {
        reason: 'unknown_vessel' as const,
        instanceId: InstanceId('a'),
        action: 'tap' as ActionName,
        vesselId: 'no-such' as VesselId,
      },
      'Action "tap" on instance "a" referenced unknown vessel "no-such"',
    ],
    [
      {
        reason: 'no_simulated_variant' as const,
        instanceId: InstanceId('a'),
        action: 'tap' as ActionName,
      },
      'Action "tap" on instance "a" — no current variant to act on',
    ],
    [
      {
        reason: 'variant_not_on_vessel' as const,
        instanceId: InstanceId('a'),
        action: 'tap' as ActionName,
        vesselId: 'v' as VesselId,
        variant: 'phantom' as VariantName,
      },
      'variant "phantom" is not defined on vessel "v"',
    ],
    [
      {
        reason: 'action_not_valid' as const,
        instanceId: InstanceId('a'),
        action: 'badAction' as ActionName,
        vesselId: 'v' as VesselId,
        variant: 'default' as VariantName,
        validActions: ['x', 'y'] as ActionName[],
      },
      'Action "badAction" is not valid on instance "a" in variant "default" — valid actions: x, y',
    ],
  ] satisfies Array<[SkippedAction, string]>)(
    'formats SkippedAction %p',
    (skipped, expected) => {
      const out = buildRetryPrompt('orig', {
        skippedActions: [skipped],
        droppedLayoutEntries: [],
        warnings: [],
        retryHint: recommendMedium,
      });
      expect(out).toContain(expected);
    },
  );

  test('action_not_valid with empty validActions formats "(none)"', () => {
    const out = buildRetryPrompt('orig', {
      skippedActions: [
        {
          reason: 'action_not_valid',
          instanceId: InstanceId('a'),
          action: 'go' as ActionName,
          vesselId: 'v' as VesselId,
          variant: 'default' as VariantName,
          validActions: [],
        },
      ],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: recommendMedium,
    });

    expect(out).toContain('valid actions: (none)');
  });

  test('state_drift skipped actions are suppressed', () => {
    const out = buildRetryPrompt('orig', {
      skippedActions: [stateDrift('a', 'go')],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: recommendMedium,
    });

    expect(out).not.toContain('Skipped actions:');
    expect(out).not.toContain('"a"');
    expect(out).not.toContain('go');
  });
});
