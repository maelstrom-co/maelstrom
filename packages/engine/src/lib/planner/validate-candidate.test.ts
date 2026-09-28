import { describe, expect, test } from 'bun:test';
import { isErr, isOk } from '@maelstrom-co/protocol';
import {
  buildGridResponse,
  invalid,
  makeGridRequest,
} from '../__test-helpers__/fixtures.js';
import {
  makePlanningInput,
  spyLogger,
} from '../__test-helpers__/stage-context.js';
import { buildActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { Logger } from '../logger.js';
import type { PlannerCandidate } from './candidate.js';
import { createCandidateValidator } from './validate-candidate.js';

function validatorFor(logger: Logger) {
  const input = makePlanningInput(makeGridRequest());
  return createCandidateValidator({
    request: input.request,
    enumSnapshot: buildActionParameterEnumSnapshot(input.request.vessels),
    messageId: input.messageId,
    logger,
  });
}

describe('createCandidateValidator', () => {
  test('heals a clean candidate into a response with diagnostics', () => {
    const validate = validatorFor(spyLogger().logger);

    const result = validate(buildGridResponse());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.userMessage).toBe('Here is your calendar!');
    expect(result.value.diagnostics.retryHint).toEqual({
      severity: 'none',
      recommend: false,
    });
  });

  test('reports a layout that heal emptied as a recommended retry', () => {
    const validate = validatorFor(spyLogger().logger);

    const result = validate(
      buildGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 0, column: 10 },
              size: { width: 6, height: 4 },
            },
          ],
        },
      }),
    );

    expect(isOk(result) && result.value.diagnostics.retryHint).toEqual({
      severity: 'unrecoverable',
      recommend: true,
    });
  });

  test('summarizes healing as counts and model-facing feedback', () => {
    const validate = validatorFor(spyLogger().logger);

    const result = validate(
      buildGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 0, column: 10 },
              size: { width: 6, height: 4 },
            },
          ],
        },
      }),
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const { counts, feedback } = result.value.diagnostics;
    expect(counts).toEqual({
      skippedActions: 0,
      droppedLayoutEntries: 1,
      warnings: 0,
    });
    expect(feedback).toContain('Layout drops:');
    expect(feedback).toContain('exceeds chart bounds');
  });

  test('a clean candidate has empty feedback', () => {
    const validate = validatorFor(spyLogger().logger);

    const result = validate(buildGridResponse());

    expect(isOk(result) && result.value.diagnostics.feedback).toBe('');
  });

  test('processes each candidate object once and returns the cached result', () => {
    const { logger, entries } = spyLogger();
    const validate = validatorFor(logger);
    const candidate = buildGridResponse({
      executionPlan: [
        { instanceId: 'calendar-main', action: 'showWeek', paramsJson: '{' },
      ],
    });

    const first = validate(candidate);
    const second = validate(candidate);

    expect(second).toBe(first);
    const logsAfterTwoCalls = entries.length;
    expect(logsAfterTwoCalls).toBeGreaterThan(0);

    const third = validate({ ...candidate });
    expect(third).not.toBe(first);
    expect(entries.length).toBe(logsAfterTwoCalls * 2);
  });

  test('a candidate cannot be edited in place once produced', () => {
    const mutate = (candidate: PlannerCandidate) => {
      // @ts-expect-error: candidates are deeply readonly
      candidate.userMessage = 'edited';
      // @ts-expect-error: candidates are deeply readonly
      candidate.executionPlan.push(candidate.executionPlan[0]!);
    };
    expect(mutate).toBeFunction();
  });

  test('a candidate without userMessage is an Err, logged once', () => {
    const { logger, entries } = spyLogger();
    const validate = validatorFor(logger);
    const candidate = buildGridResponse({ userMessage: '   ' });

    const result = validate(candidate);
    validate(candidate);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ParseError');
    expect(entries.map((e) => e.msg)).toEqual([
      'Failed to process LLM response',
    ]);
  });

  test.each([
    [
      'a tiling-shaped candidate for a grid request',
      {
        userMessage: 'hi',
        rationale: 'r',
        executionPlan: [],
        layout: { tree: ['calendar-main'], instances: [] },
      },
    ],
    [
      'a candidate without an executionPlan',
      {
        userMessage: 'hi',
        rationale: 'r',
        layout: { positions: [] },
      },
    ],
  ])('%s is Err(ValidationError) on field "planner" naming the schema', (_case, candidate) => {
    const { logger, entries } = spyLogger();
    const validate = validatorFor(logger);

    const result = validate(invalid<PlannerCandidate>(candidate));

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
      message: expect.stringContaining('grid response schema'),
    });
    expect(entries.map((e) => e.msg)).toEqual([
      'Planner candidate does not match the response schema',
    ]);
  });

  test('a throw while processing becomes Err(ValidationError) on field "response"', () => {
    const { logger, entries } = spyLogger();
    const validate = validatorFor(logger);

    // Passes the schema check, then throws when healing reads it again.
    let rationaleReads = 0;
    const result = validate(
      invalid<PlannerCandidate>({
        userMessage: 'hi',
        executionPlan: [],
        layout: { positions: [] },
        get rationale() {
          rationaleReads += 1;
          if (rationaleReads > 1) throw new Error('invariant broken');
          return 'r';
        },
      }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'response',
    });
    expect(entries.map((e) => e.msg)).toEqual([
      'Engine invariant violation while processing LLM response',
    ]);
  });
});
