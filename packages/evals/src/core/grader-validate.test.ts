import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import type { TilingNode } from '@maelstrom-co/protocol';

import {
  GRADER_VERSION,
  type GraderDimension,
  type GraderGrade,
} from './grader.js';
import {
  type GradedResponse,
  type GraderLabel,
  type GraderValidation,
  graderGate,
  isGraderValidation,
  loadGraderLabels,
  shippedFromRecord,
  spearman,
  validateGrader,
} from './grader-validate.js';
import type { RunRecord } from './run.js';
import { selectScenarios } from './scenarios.js';
import { VERBALIZER_VERSION } from './verbalize-tree.js';

const pass = { pass: true, failures: [] };
const fail = { pass: false, failures: ['x'] };

describe('spearman', () => {
  test('is 1 for the same order and -1 for the reverse', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 35, 90])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  test('gives ties their average rank', () => {
    // Ranks [1, 2.5, 2.5, 4] against [1, 2, 3, 4]: Pearson of the ranks.
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9486833, 6);
  });

  test('is undefined without two values or without spread', () => {
    expect(spearman([0.5], [0.5])).toBe(undefined);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBe(undefined);
  });
});

describe('validateGrader', () => {
  // Ten labelled responses the grader ranks in the same order as the labels.
  const labelled = Array.from({ length: 10 }, (_, index) => ({
    arm: 'jev-poc',
    scenarioId: `case-${index}`,
    repeat: 1,
    label: index / 9,
    graded: 0.1 + (index / 9) * 0.8,
  }));
  const labels: GraderLabel[] = labelled.map((entry) => ({
    scenarioId: entry.scenarioId,
    arm: entry.arm,
    repeat: entry.repeat,
    request_satisfied: entry.label,
    arrangement_match: entry.label,
  }));

  /**
   * Ten arrangement-rule turns; the grader agrees with the rule-based
   * arrangement pass on `agreeing` of them.
   */
  function fixture(agreeing: number) {
    const records: RunRecord[] = labelled.map((entry, index) =>
      record({
        scenarioId: entry.scenarioId,
        arrangementRules: true,
        score: {
          ...(entry.graded >= 0.5 ? pass : fail),
          arrangement:
            index < agreeing
              ? entry.graded >= 0.5
                ? pass
                : fail
              : entry.graded >= 0.5
                ? fail
                : pass,
        },
      }),
    );
    const grades: GradedResponse[] = labelled.map((entry) => ({
      arm: entry.arm,
      scenarioId: entry.scenarioId,
      repeat: entry.repeat,
      grade: grade({
        request_satisfied: entry.graded,
        arrangement_match: entry.graded,
      }),
    }));
    return { records, grades };
  }

  test('passes the gate at rank correlation 1 and 90% agreement', () => {
    const validation = validateGrader({ labels, ...fixture(9) });
    expect(validation.rho).toEqual({
      request_satisfied: expect.closeTo(1, 10),
      arrangement_match: expect.closeTo(1, 10),
    });
    expect(validation.gateRho).toBeCloseTo(1, 10);
    // |0.1 + 0.8x - x| = |0.1 - 0.2x|, averaged over x = 0, 1/9, ..., 1.
    const expectedError =
      labelled.reduce(
        (sum, entry) => sum + Math.abs(entry.graded - entry.label),
        0,
      ) / labelled.length;
    expect(validation.meanAbsoluteError.request_satisfied).toBeCloseTo(
      expectedError,
      10,
    );
    expect(validation.agreement).toEqual({ agree: 9, total: 10 });
    expect(validation.labels).toEqual({ total: 10, matched: 10 });
    expect(validation.passed).toBe(true);
    expect(graderGate(validation)).toEqual({
      validated: true,
      line: 'grader: validated (rho=1.00, agreement=90.0%)',
    });
  });

  test('fails the gate below 85% agreement even with perfect correlation', () => {
    const validation = validateGrader({ labels, ...fixture(8) });
    expect(validation.agreement).toEqual({ agree: 8, total: 10 });
    expect(validation.passed).toBe(false);
    expect(graderGate(validation)).toEqual({
      validated: false,
      line: 'grader: unvalidated (rho=1.00, agreement=80.0%)',
    });
  });

  test('fails the gate when the weaker dimension ranks below 0.7', () => {
    const { records, grades } = fixture(10);
    const shuffled = grades.map((entry, index) => ({
      ...entry,
      grade: grade({
        request_satisfied: entry.grade.dimensions?.request_satisfied.score ?? 0,
        arrangement_match: [0.9, 0.2, 0.8, 0.1, 0.7, 0.3, 0.6, 0.4, 0.5, 0.45][
          index
        ] as number,
      }),
    }));
    const validation = validateGrader({ labels, records, grades: shuffled });
    expect(validation.rho.request_satisfied).toBeCloseTo(1, 10);
    expect(validation.gateRho).toBeLessThan(0.7);
    expect(validation.passed).toBe(false);
    expect(graderGate(validation).line).toStartWith(
      'grader: unvalidated (rho=',
    );
  });

  test('without labels the rank correlation is n/a and the gate fails', () => {
    const validation = validateGrader({ labels: [], ...fixture(10) });
    expect(validation.rho).toEqual({
      request_satisfied: undefined,
      arrangement_match: undefined,
    });
    expect(validation.passed).toBe(false);
    expect(graderGate(validation).line).toBe(
      'grader: unvalidated (rho=n/a, agreement=100.0%)',
    );
  });

  test('ignores failed grades, grades from another grader version and turns without arrangement rules', () => {
    const { records, grades } = fixture(10);
    const validation = validateGrader({
      labels,
      records: [...records, record({ scenarioId: 'no-rules', score: pass })],
      grades: [
        ...grades.slice(0, 8),
        { ...grades[8], grade: { ...grades[8].grade, graderVersion: 0 } },
        {
          ...grades[9],
          grade: {
            graderVersion: GRADER_VERSION,
            verbalizerVersion: VERBALIZER_VERSION,
            failure: 'grader/provider_http',
          },
        },
        {
          arm: 'jev-poc',
          scenarioId: 'no-rules',
          repeat: 1,
          grade: grade({ request_satisfied: 1, arrangement_match: 0 }),
        },
      ] as GradedResponse[],
    });
    expect(validation.labels).toEqual({ total: 10, matched: 8 });
    expect(validation.agreement).toEqual({ agree: 8, total: 8 });
  });

  test('never passes on fewer than ten matched labels', () => {
    const { records, grades } = fixture(10);
    const validation = validateGrader({
      labels: labels.slice(0, 9),
      records,
      grades,
    });
    expect(validation.gateRho).toBeCloseTo(1, 10);
    expect(validation.passed).toBe(false);
  });
});

describe('graderGate', () => {
  test('reads a missing validation as not run', () => {
    expect(graderGate(undefined)).toEqual({
      validated: false,
      line: 'grader: unvalidated (rho=n/a, agreement=n/a)',
    });
  });

  test('does not trust a validation made with another grader or verbalizer version', () => {
    const stale = {
      ...validateGrader({ labels: [], records: [], grades: [] }),
      passed: true,
      gateRho: 0.9,
      agreement: { agree: 9, total: 10 },
      graderVersion: GRADER_VERSION - 1,
    };
    expect(graderGate(stale)).toEqual({
      validated: false,
      line: 'grader: unvalidated (rho=0.90, agreement=90.0%)',
    });
  });
});

describe('isGraderValidation', () => {
  const valid: GraderValidation = {
    graderVersion: GRADER_VERSION,
    verbalizerVersion: VERBALIZER_VERSION,
    labels: { total: 10, matched: 10 },
    rho: { request_satisfied: 0.9, arrangement_match: 0.8 },
    gateRho: 0.8,
    meanAbsoluteError: { request_satisfied: 0.1, arrangement_match: 0.2 },
    agreement: { agree: 9, total: 10 },
    passed: true,
  };

  test('accepts a well-formed validation, undefined correlations included', () => {
    expect(isGraderValidation(valid)).toBe(true);
    expect(
      isGraderValidation({
        ...valid,
        rho: { request_satisfied: undefined, arrangement_match: undefined },
        gateRho: undefined,
      }),
    ).toBe(true);
    // JSON.stringify drops undefined-valued keys, so a round trip omits them.
    expect(isGraderValidation(JSON.parse(JSON.stringify(valid)))).toBe(true);
  });

  test('rejects non-objects and a file missing a required field', () => {
    expect(isGraderValidation(null)).toBe(false);
    expect(isGraderValidation([])).toBe(false);
    expect(isGraderValidation('not json')).toBe(false);
    const { passed: _passed, ...withoutPassed } = valid;
    expect(isGraderValidation(withoutPassed)).toBe(false);
  });

  test('rejects a field of the wrong type', () => {
    expect(isGraderValidation({ ...valid, passed: 'yes' })).toBe(false);
    expect(isGraderValidation({ ...valid, gateRho: 'high' })).toBe(false);
    expect(
      isGraderValidation({ ...valid, labels: { total: '10', matched: 10 } }),
    ).toBe(false);
    expect(
      isGraderValidation({
        ...valid,
        rho: { request_satisfied: 0.9 },
      }),
    ).toBe(true);
    expect(
      isGraderValidation({
        ...valid,
        rho: { request_satisfied: 0.9, arrangement_match: 'high' },
      }),
    ).toBe(false);
  });
});

describe('loadGraderLabels', () => {
  test('reads an absent labels file as no labels', async () => {
    expect(
      await loadGraderLabels(
        join(import.meta.dir, 'fixtures/absent-labels.ts'),
      ),
    ).toEqual([]);
  });
});

describe('shippedFromRecord', () => {
  const [swap] = selectScenarios('development', ['swap']);
  const [quoted] = selectScenarios('development', ['quoted-location']);
  if (!swap || !quoted) throw new Error('fixture scenarios are missing');
  const tree = ['V', 'ID:map-main', 'ID:calendar-main'] as TilingNode[];

  test('reads the shipped plan and instances a record carries', async () => {
    const instances = [
      { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
    ];
    expect(
      await shippedFromRecord(
        record({
          userMessage: 'Done.',
          tree,
          executionPlan: [],
          instances,
          fallbackCalls: 1,
        } as unknown as Partial<RunRecord>),
        swap,
      ),
    ).toEqual({
      userMessage: 'Done.',
      tree,
      executionPlan: [],
      instances,
    } as never);
  });

  test('never infers a response for a record that carries a plan but no tiling instances', async () => {
    expect(
      await shippedFromRecord(
        record({
          scenarioId: 'swap',
          userMessage: 'Done.',
          tree: [],
          executionPlan: [],
          fallbackCalls: 1,
          expectsActions: false,
          score: pass,
        }),
        swap,
      ),
    ).toBe(undefined);
  });

  describe('from the completion stage of a turn that did not fall back', () => {
    const candidate = {
      userMessage: 'Tokyo it is.',
      rationale: 'Set the weather location.',
      executionPlan: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          paramsJson: '{"location":"Tokyo"}',
        },
      ],
      layout: {
        tree:
          quoted.request.layout.type === 'tiling'
            ? quoted.request.layout.tree
            : [],
        instances: quoted.request.instances,
      },
    };
    const stages = {
      stage: 'complete',
      records: [{ stage: 'complete', ms: 1, outcome: 'ok', output: candidate }],
    } as never;
    const shippedRecord = record({
      scenarioId: 'quoted-location',
      userMessage: candidate.userMessage,
      tree: candidate.layout.tree,
      fallbackCalls: 0,
    });

    test('reads the plan and instances the Engine ships from the candidate', async () => {
      const shipped = await shippedFromRecord(shippedRecord, quoted, stages);
      expect(shipped?.userMessage).toBe(candidate.userMessage);
      expect(shipped?.tree).toEqual(candidate.layout.tree as never);
      expect(shipped?.executionPlan).toEqual([
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Tokyo' },
        },
      ] as never);
      expect(shipped?.instances.map((instance) => instance.instanceId)).toEqual(
        quoted.request.instances.map((instance) => instance.instanceId),
      );
    });

    test('rejects a candidate whose message or tree is not what the record shipped', async () => {
      expect(
        await shippedFromRecord(
          { ...shippedRecord, userMessage: 'Something else.' },
          quoted,
          stages,
        ),
      ).toBe(undefined);
      expect(
        await shippedFromRecord({ ...shippedRecord, tree }, quoted, stages),
      ).toBe(undefined);
    });
  });

  test('infers an empty plan and unchanged variants when the rule-based score proves them', async () => {
    // swap expects no actions; a score without action or variant failures
    // means the shipped plan was empty and every existing instance kept its variant.
    const fellBack = record({
      scenarioId: 'swap',
      userMessage: 'Shipped.',
      tree,
      fallbackCalls: 1,
      expectsActions: false,
      score: pass,
    });
    expect(await shippedFromRecord(fellBack, swap)).toEqual({
      userMessage: 'Shipped.',
      tree,
      executionPlan: [],
      instances: swap.request.instances,
    });
    expect(
      await shippedFromRecord(
        {
          ...fellBack,
          score: {
            pass: false,
            failures: ['Ordered actions: expected [], received [{}]'],
          },
        },
        swap,
      ),
    ).toBe(undefined);
    expect(
      await shippedFromRecord(
        { ...fellBack, tree: ['V', 'ID:map-main', 'ID:map-2'] },
        swap,
      ),
    ).toBe(undefined);
    expect(
      await shippedFromRecord({ ...fellBack, score: undefined }, swap),
    ).toBe(undefined);
  });

  test('infers nothing when the record was scored against a scenario that expected actions', async () => {
    const scoredAgainstActions = record({
      scenarioId: 'swap',
      userMessage: 'Shipped.',
      tree,
      fallbackCalls: 1,
      score: pass,
    });
    expect(await shippedFromRecord(scoredAgainstActions, swap)).toBe(undefined);
    expect(
      await shippedFromRecord(
        { ...scoredAgainstActions, expectsActions: true },
        swap,
      ),
    ).toBe(undefined);
  });
});

function record(overrides: Partial<RunRecord>): RunRecord {
  return {
    scenarioId: 's',
    suite: 'development',
    arm: 'jev-poc',
    kind: 'jev-poc',
    repeat: 1,
    turnMs: 100,
    expectedDeferral: false,
    arrangementRules: false,
    ...overrides,
  };
}

function grade(scores: Readonly<Record<GraderDimension, number>>): GraderGrade {
  return {
    graderVersion: GRADER_VERSION,
    verbalizerVersion: VERBALIZER_VERSION,
    dimensions: {
      request_satisfied: {
        score: scores.request_satisfied,
        samples: [scores.request_satisfied * 4],
      },
      arrangement_match: {
        score: scores.arrangement_match,
        samples: [scores.arrangement_match * 4],
      },
    },
  };
}
