import { describe, expect, test } from 'bun:test';

import type {
  ChartRequest,
  NeedsClarification,
  TilingResponse,
} from '@maelstrom-co/protocol';
import { isErr, isOk } from '@maelstrom-co/protocol';

import type {
  AuthorVessel,
  TilingResponseAuthor,
} from '../__test-helpers__/fixtures.js';
import {
  brandTilingResponse,
  buildGridResponse,
  invalid,
  makeGridRequest,
  makeTilingRequest,
} from '../__test-helpers__/fixtures.js';
import {
  makePlanningInput,
  spyLogger,
} from '../__test-helpers__/stage-context.js';
import { buildActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { Logger } from '../logger.js';
import type { PlannerCandidate, ReplylessCandidate } from './candidate.js';
import { createCandidateValidator } from './validate-candidate.js';

function validatorFor(
  logger: Logger,
  request: ChartRequest = makeGridRequest(),
) {
  const input = makePlanningInput(request);
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
        type: 'plan',
        userMessage: 'hi',
        rationale: 'r',
        executionPlan: [],
        layout: { tree: ['calendar-main'], instances: [] },
      },
    ],
    [
      'a candidate without an executionPlan',
      {
        type: 'plan',
        userMessage: 'hi',
        rationale: 'r',
        layout: { positions: [] },
      },
    ],
  ])(
    '%s is Err(ValidationError) on field "planner" naming the schema',
    (_case, candidate) => {
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
    },
  );

  test('a throw while processing becomes Err(ValidationError) on field "response"', () => {
    const { logger, entries } = spyLogger();
    const validate = validatorFor(logger);

    // Passes the schema check, then throws when healing reads it again.
    let rationaleReads = 0;
    const result = validate(
      invalid<PlannerCandidate>({
        type: 'plan',
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

describe('createCandidateValidator with skipReply', () => {
  const skipReplyRequest = (skipReply: boolean | undefined): ChartRequest =>
    skipReply === undefined
      ? makeGridRequest()
      : { ...makeGridRequest(), skipReply };

  const withoutReply = (): ReplylessCandidate => {
    const { userMessage: _omitted, ...rest } = buildGridResponse();
    return rest;
  };

  const clarification: Omit<NeedsClarification, 'layout' | 'executionPlan'> = {
    type: 'needs_clarification',
    question: 'Which order do you mean?',
    options: ['The latest order', 'The order from last week'],
  };

  test.each([
    ['absent', undefined],
    ['false', false],
  ])(
    'a candidate without userMessage is still an Err when skipReply is %s',
    (_case, skipReply) => {
      const validate = validatorFor(
        spyLogger().logger,
        skipReplyRequest(skipReply),
      );

      const result = validate(withoutReply());

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error).toMatchObject({
        _tag: 'ValidationError',
        field: 'planner',
      });
    },
  );

  test.each([
    ['absent', undefined],
    ['false', false],
  ])(
    'a blank userMessage is still a ParseError when skipReply is %s',
    (_case, skipReply) => {
      const validate = validatorFor(
        spyLogger().logger,
        skipReplyRequest(skipReply),
      );

      const result = validate(buildGridResponse({ userMessage: '  ' }));

      expect(isErr(result) && result.error._tag).toBe('ParseError');
    },
  );

  test('a candidate without userMessage is accepted when skipReply is true', () => {
    const validate = validatorFor(spyLogger().logger, skipReplyRequest(true));

    const result = validate(withoutReply());

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'maelstrom_response') return;
    expect('userMessage' in result.value).toBe(false);
    expect(result.value.layout.type).toBe('grid');
    expect(result.value.diagnostics.retryHint.recommend).toBe(false);
  });

  test('a present userMessage passes through when skipReply is true', () => {
    const validate = validatorFor(spyLogger().logger, skipReplyRequest(true));

    const result = validate(buildGridResponse({ userMessage: 'Done' }));

    expect(
      isOk(result) &&
        result.value.type === 'maelstrom_response' &&
        result.value.userMessage,
    ).toBe('Done');
  });

  test('a strict candidate with a blank userMessage keeps that reply when skipReply is true', () => {
    const validate = validatorFor(spyLogger().logger, skipReplyRequest(true));
    const candidate: PlannerCandidate = buildGridResponse({
      userMessage: '  ',
    });

    const result = validate(candidate);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.userMessage).toBe('  ');
    expect(result.value.userMessage.trim()).toBe('');
  });

  test('a needs-clarification result is accepted when skipReply is true', () => {
    const { logger, entries } = spyLogger();
    const validate = validatorFor(logger, skipReplyRequest(true));

    const result = validate(clarification);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual({
      ...clarification,
      diagnostics: {
        retryHint: { severity: 'none', recommend: false },
        counts: { skippedActions: 0, droppedLayoutEntries: 0, warnings: 0 },
        feedback: '',
        skippedActions: [],
        droppedLayoutEntries: [],
        warnings: [],
      },
    });
    expect('layout' in result.value).toBe(false);
    expect('executionPlan' in result.value).toBe(false);
    expect(entries).toEqual([]);
  });

  test('a needs-clarification result is validated once per object', () => {
    const validate = validatorFor(spyLogger().logger, skipReplyRequest(true));

    expect(validate(clarification)).toBe(validate(clarification));
  });

  test('a rejected needs-clarification result is validated and logged once per object', () => {
    const { logger, entries } = spyLogger();
    const validate = validatorFor(logger, skipReplyRequest(undefined));

    const first = validate(clarification);
    const second = validate(clarification);

    expect(isErr(first)).toBe(true);
    expect(second).toBe(first);
    expect(entries).toHaveLength(1);
  });

  test('a needs-clarification result is accepted for a tiling request with skipReply', () => {
    const validate = validatorFor(spyLogger().logger, {
      ...makeTilingRequest(),
      skipReply: true,
    });

    const result = validate(clarification);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toMatchObject(clarification);
    expect('layout' in result.value).toBe(false);
    expect(result.value.diagnostics.retryHint.recommend).toBe(false);
  });

  test('onValidated receives the report on the first call and on every cached call', () => {
    const request = skipReplyRequest(true);
    const reports: unknown[] = [];
    const validate = createCandidateValidator({
      request,
      enumSnapshot: buildActionParameterEnumSnapshot(request.vessels),
      messageId: makePlanningInput(request).messageId,
      logger: spyLogger().logger,
      onValidated: (report) => reports.push(report),
    });

    const first = validate(clarification);
    const second = validate(clarification);

    expect(reports).toHaveLength(2);
    expect(reports[0]).toBe(first);
    expect(reports[1]).toBe(second);
  });

  test.each([
    ['absent', undefined],
    ['false', false],
  ])(
    'a needs-clarification result is Err(ValidationError) naming skipReply when skipReply is %s',
    (_case, skipReply) => {
      const { logger, entries } = spyLogger();
      const validate = validatorFor(logger, skipReplyRequest(skipReply));

      const result = validate(clarification);

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error).toMatchObject({
        _tag: 'ValidationError',
        field: 'planner',
        message: expect.stringContaining('skipReply'),
      });
      expect(entries.map((e) => e.msg)).toEqual([
        'Planner returned a needs-clarification result without skipReply',
      ]);
    },
  );

  test('a malformed needs-clarification result is Err(ValidationError) when skipReply is true', () => {
    const validate = validatorFor(spyLogger().logger, skipReplyRequest(true));

    const result = validate(
      invalid<NeedsClarification>({
        type: 'needs_clarification',
        question: '   ',
      }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
      message: expect.stringContaining('needs-clarification schema'),
    });
  });
});

describe('createCandidateValidator result type', () => {
  const withType = (type: unknown) => {
    const { type: _omitted, ...rest } = buildGridResponse();
    return invalid<PlannerCandidate>(
      type === undefined ? rest : { ...rest, type },
    );
  };

  test.each([
    ['missing', undefined, 'no type'],
    ['unknown', 'layout', "'layout'"],
    ['not a string', 1, 'number'],
  ] as const)(
    'a plan result whose type is %s is Err(ValidationError) on field "planner" with and without skipReply',
    (_case, type, described) => {
      for (const skipReply of [undefined, true]) {
        const { logger, entries } = spyLogger();
        const validate = validatorFor(logger, {
          ...makeGridRequest(),
          ...(skipReply === undefined ? {} : { skipReply }),
        });

        const result = validate(withType(type));

        expect(isErr(result)).toBe(true);
        if (!isErr(result)) return;
        expect(result.error).toMatchObject({
          _tag: 'ValidationError',
          field: 'planner',
          message: expect.stringContaining(`got ${described}`),
        });
        expect(entries.map((e) => e.msg)).toEqual([
          'Planner result has an unknown type',
        ]);
      }
    },
  );

  test('a primitive result is Err(ValidationError) on field "planner"', () => {
    const validate = validatorFor(spyLogger().logger);

    const result = validate(invalid<PlannerCandidate>(null));

    expect(isErr(result) && result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
    });
  });

  test("a clarification's layout must match the request mode", () => {
    const validate = validatorFor(spyLogger().logger, {
      ...makeGridRequest(),
      skipReply: true,
    });

    const result = validate(
      invalid<NeedsClarification>({
        type: 'needs_clarification',
        question: 'Which share class?',
        layout: { tree: ['ID:calendar-main'], instances: [] },
      }),
    );

    expect(isErr(result) && result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
      message: expect.stringContaining('needs-clarification schema'),
    });
  });
});

describe('createCandidateValidator partial changes on a clarification', () => {
  const stockVessel: AuthorVessel = {
    id: 'stock',
    name: 'Stock',
    description: 'Shows a stock price',
    defaultVariant: 'compact',
    variants: {
      compact: {
        props: {},
        minSize: { width: 2, height: 2 },
        actions: [
          {
            name: 'expand',
            description: 'Show the price history',
            transitionsTo: 'detail',
          },
        ],
      },
      detail: {
        props: {},
        minSize: { width: 4, height: 4 },
        actions: [
          {
            name: 'collapse',
            description: 'Show the price only',
            transitionsTo: 'compact',
          },
        ],
      },
    },
  };
  const calendarVessel: AuthorVessel = {
    id: 'calendar',
    name: 'Calendar',
    description: 'Displays events',
    defaultVariant: 'month',
    variants: {
      month: { props: {}, minSize: { width: 4, height: 4 }, actions: [] },
    },
  };
  const stockRequest = (): ChartRequest => ({
    ...makeTilingRequest({
      context: {
        updateReasons: [
          { type: 'user_intent', intent: 'Show Apple and Alphabet stock' },
        ],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'tiling',
      },
      vessels: [calendarVessel, stockVessel],
    }),
    skipReply: true,
  });
  const gridRequest = (): ChartRequest => ({
    ...makeGridRequest(),
    skipReply: true,
  });
  const appleLayout: TilingResponseAuthor['layout'] = {
    tree: ['H:2,x', 'calendar-main', 'stock-aapl'],
    instances: [
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
      { instanceId: 'stock-aapl', vesselId: 'stock', variant: 'compact' },
    ],
  };
  const applePlan = (
    overrides: Partial<TilingResponseAuthor> = {},
  ): TilingResponse =>
    brandTilingResponse({
      userMessage: 'Here is Apple.',
      rationale: 'Apple is unambiguous',
      executionPlan: [{ instanceId: 'stock-aapl', action: 'expand' }],
      layout: appleLayout,
      ...overrides,
    });
  const clarifyWith = <M extends 'grid' | 'tiling'>(
    changes: Pick<NeedsClarification<M>, 'layout' | 'executionPlan'>,
  ): NeedsClarification<M> => ({
    type: 'needs_clarification',
    question: 'Which Alphabet share class do you mean?',
    options: ['GOOGL', 'GOOG'],
    ...changes,
  });

  test('valid partial changes are healed the same way as an equivalent plan', () => {
    const plan = applePlan();
    const { layout, executionPlan } = plan;
    const validate = validatorFor(spyLogger().logger, stockRequest());

    const planned = validate(plan);
    const clarified = validate(
      clarifyWith<'tiling'>({ layout, executionPlan }),
    );

    expect(isOk(planned) && isOk(clarified)).toBe(true);
    if (!isOk(planned) || !isOk(clarified)) return;
    expect(clarified.value).toEqual({
      type: 'needs_clarification',
      question: 'Which Alphabet share class do you mean?',
      options: ['GOOGL', 'GOOG'],
      layout: planned.value.layout,
      executionPlan: planned.value.executionPlan,
      diagnostics: planned.value.diagnostics,
    });
    expect(clarified.value.executionPlan).toHaveLength(1);
    expect(clarified.value.diagnostics.warnings).not.toEqual([]);
    expect(
      clarified.value.layout?.type === 'tiling' && clarified.value.layout.tree,
    ).not.toContain('H:2,x');
  });

  test('a layout without an execution plan keeps the execution plan absent', () => {
    const { layout } = applePlan({ executionPlan: [] });
    const validate = validatorFor(spyLogger().logger, stockRequest());

    const result = validate(clarifyWith<'tiling'>({ layout }));

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'needs_clarification') return;
    expect(result.value.layout?.type).toBe('tiling');
    expect('executionPlan' in result.value).toBe(false);
  });

  test('an execution plan without a layout is checked against the current layout', () => {
    const plan = buildGridResponse({
      executionPlan: [{ instanceId: 'calendar-main', action: 'showWeek' }],
    });
    const validate = validatorFor(spyLogger().logger, gridRequest());

    const planned = validate(plan);
    const clarified = validate(
      clarifyWith<'grid'>({ executionPlan: plan.executionPlan }),
    );

    expect(isOk(planned) && isOk(clarified)).toBe(true);
    if (!isOk(planned) || !isOk(clarified)) return;
    expect(clarified.value.executionPlan).toEqual(planned.value.executionPlan);
    expect(clarified.value.executionPlan).toHaveLength(1);
    expect('layout' in clarified.value).toBe(false);
    expect(clarified.value.diagnostics.retryHint).toEqual({
      severity: 'none',
      recommend: false,
    });
  });

  test.each([
    [
      'a grid position outside the chart',
      gridRequest,
      () =>
        clarifyWith<'grid'>({
          layout: buildGridResponse({
            layout: {
              positions: [
                {
                  instanceId: 'calendar-main',
                  position: { row: 0, column: 10 },
                  size: { width: 6, height: 4 },
                },
              ],
            },
          }).layout,
        }),
    ],
    [
      'a tiling instance of an unknown vessel',
      stockRequest,
      () =>
        clarifyWith<'tiling'>({
          layout: applePlan({
            executionPlan: [],
            layout: {
              tree: ['H', 'calendar-main', 'stock-aapl'],
              instances: [
                {
                  instanceId: 'calendar-main',
                  vesselId: 'calendar',
                  variant: 'month',
                },
                {
                  instanceId: 'stock-aapl',
                  vesselId: 'ticker',
                  variant: 'compact',
                },
              ],
            },
          }).layout,
        }),
    ],
  ] as const)(
    'a layout with %s is Err(ValidationError) on field "planner"',
    (_case, request, clarification) => {
      const { logger, entries } = spyLogger();
      const validate = validatorFor(logger, request());

      const result = validate(clarification());

      expect(isErr(result) && result.error).toMatchObject({
        _tag: 'ValidationError',
        field: 'planner',
        message: expect.stringContaining('fail plan validation'),
      });
      expect(entries.map((e) => e.msg)).toEqual([
        'Planner clarification carries invalid partial changes',
      ]);
    },
  );

  test.each([
    ['an unknown instance', 'stock-goog', 'showWeek'],
    ['an action the variant does not offer', 'calendar-main', 'showYear'],
  ])(
    'an execution plan naming %s is Err(ValidationError) on field "planner"',
    (_case, instanceId, action) => {
      const validate = validatorFor(spyLogger().logger, gridRequest());
      const { executionPlan } = buildGridResponse({
        executionPlan: [{ instanceId, action }],
      });

      const result = validate(clarifyWith<'grid'>({ executionPlan }));

      expect(isErr(result) && result.error).toMatchObject({
        _tag: 'ValidationError',
        field: 'planner',
        message: expect.stringContaining('fail plan validation'),
      });
    },
  );

  test('an action invalid against the layout it ships with is rejected', () => {
    const { layout, executionPlan } = applePlan({
      executionPlan: [{ instanceId: 'stock-aapl', action: 'showWeek' }],
    });
    const validate = validatorFor(spyLogger().logger, stockRequest());

    const result = validate(clarifyWith<'tiling'>({ layout, executionPlan }));

    expect(isErr(result) && result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
    });
  });

  test('an action a retry could not fix is skipped as it is for a plan', () => {
    const { executionPlan } = buildGridResponse({
      executionPlan: [{ instanceId: 'calendar-main', action: 'showMonth' }],
    });
    const validate = validatorFor(spyLogger().logger, gridRequest());

    const result = validate(clarifyWith<'grid'>({ executionPlan }));

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.executionPlan).toEqual([]);
    expect(
      result.value.diagnostics.skippedActions.map((skip) => skip.reason),
    ).toEqual(['self_transition_noop']);
  });

  test('partial changes do not lift the skipReply requirement', () => {
    const { logger, entries } = spyLogger();
    const validate = validatorFor(logger, makeGridRequest());
    const { layout, executionPlan } = buildGridResponse();

    const result = validate(clarifyWith<'grid'>({ layout, executionPlan }));

    expect(isErr(result) && result.error).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
      message: expect.stringContaining('skipReply'),
    });
    expect(entries.map((e) => e.msg)).toEqual([
      'Planner returned a needs-clarification result without skipReply',
    ]);
  });
});
