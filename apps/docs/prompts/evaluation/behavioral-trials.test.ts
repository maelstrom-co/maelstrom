import { describe, expect, test } from 'bun:test';
import {
  aggregateBehavioralAssessments,
  type BehavioralAssessment,
  type BehavioralTrialId,
  behavioralTrials,
} from './behavioral-trials';
import { buildCaseInput } from './cases';

const cases: {
  id: BehavioralTrialId;
  expectedCase: string;
  goodExample: string;
  badExample: string;
}[] = [
  {
    id: 'onboarding-procedure',
    expectedCase: 'onboarding-implementation',
    goodExample: 'preserve-queue-and-wrap-it',
    badExample: 'blank-chart-replacement',
  },
  {
    id: 'migration-procedure',
    expectedCase: 'react-conversion',
    goodExample: 'wrap-panel-retain-handler',
    badExample: 'replace-search-with-live-fetch',
  },
  {
    id: 'debugging-procedure',
    expectedCase: 'debugging-read-only',
    goodExample: 'separate-attempts-and-correlate',
    badExample: 'assume-shared-provider-outage',
  },
];

async function fixtureTexts(trialId: BehavioralTrialId) {
  const context = await buildCaseInput(behavioralTrials[trialId].caseId);
  return Object.fromEntries(
    context.fixtureFiles.map(({ path, text }) => [path, text]),
  );
}

describe('curated behavioral assessment examples', () => {
  for (const { id, expectedCase, goodExample, badExample } of cases) {
    test(`${id} has distinct evidence-backed assessments of procedure and usefulness`, async () => {
      const trial = behavioralTrials[id];
      expect(trial.caseId).toBe(expectedCase);
      expect(trial.examples.map(({ example }) => example)).toEqual([
        goodExample,
        badExample,
      ]);
      expect(
        trial.examples.map(({ response }) => response.length > 100),
      ).toEqual([true, true]);

      const aggregate = aggregateBehavioralAssessments(
        id,
        trial.examples.map(({ example, procedureSelection, usefulness }) => ({
          example,
          procedureSelection,
          usefulness,
        })),
        await fixtureTexts(id),
      );
      expect(aggregate.caseId).toBe(expectedCase);
      expect(
        aggregate.assessments.map(({ procedureSelection, usefulness }) => [
          procedureSelection.score,
          usefulness.score,
        ]),
      ).toEqual([
        [2, 2],
        [0, 0],
      ]);
      for (const assessment of aggregate.assessments) {
        for (const dimension of [
          assessment.procedureSelection,
          assessment.usefulness,
        ]) {
          expect(dimension.rationale.trim().length).toBeGreaterThan(30);
          expect(dimension.evidence.length).toBeGreaterThan(0);
        }
      }
    });
  }

  test('preserves mixed independent scores when example labels and responses are unchanged', async () => {
    for (const { id } of cases) {
      const trial = behavioralTrials[id];
      const responsesBefore = trial.examples.map(({ example, response }) => ({
        example,
        response,
      }));
      const assessments: BehavioralAssessment[] = trial.examples.map(
        ({ example, procedureSelection, usefulness }) => ({
          example,
          procedureSelection: { ...procedureSelection },
          usefulness: { ...usefulness },
        }),
      );
      assessments[0]!.procedureSelection.score = 1;
      assessments[0]!.usefulness.score = 0;
      assessments[1]!.procedureSelection.score = 2;
      assessments[1]!.usefulness.score = 1;

      const aggregate = aggregateBehavioralAssessments(
        id,
        assessments,
        await fixtureTexts(id),
      );
      expect(
        aggregate.assessments.map(
          ({ example, procedureSelection, usefulness }) => [
            example,
            procedureSelection.score,
            usefulness.score,
          ],
        ),
      ).toEqual([
        [trial.examples[0]!.example, 1, 0],
        [trial.examples[1]!.example, 2, 1],
      ]);
      expect(
        trial.examples.map(({ example, response }) => ({ example, response })),
      ).toEqual(responsesBefore);
    }
  });

  test('rejects mislabeled, incomplete, and duplicate assessment records', async () => {
    const trial = behavioralTrials['debugging-procedure'];
    const assessments = trial.examples.map(
      ({ example, procedureSelection, usefulness }) => ({
        example,
        procedureSelection,
        usefulness,
      }),
    );
    const texts = await fixtureTexts('debugging-procedure');

    expect(() =>
      aggregateBehavioralAssessments(
        'debugging-procedure',
        [
          { ...assessments[0]!, example: 'onboarding-procedure' },
          assessments[1]!,
        ],
        texts,
      ),
    ).toThrow('Unknown example label');
    expect(() =>
      aggregateBehavioralAssessments(
        'debugging-procedure',
        [assessments[0]!],
        texts,
      ),
    ).toThrow('Missing example assessment');
    expect(() =>
      aggregateBehavioralAssessments(
        'debugging-procedure',
        [assessments[0]!, assessments[0]!],
        texts,
      ),
    ).toThrow('Duplicate example assessment');
  });

  test('rejects evidence-free, unsupported, and unreasoned assessment dimensions', async () => {
    const trial = behavioralTrials['migration-procedure'];
    const assessments = trial.examples.map(
      ({ example, procedureSelection, usefulness }) => ({
        example,
        procedureSelection,
        usefulness,
      }),
    );
    const texts = await fixtureTexts('migration-procedure');
    const noEvidence: BehavioralAssessment[] = structuredClone(assessments);
    noEvidence[0]!.usefulness.evidence = [];
    expect(() =>
      aggregateBehavioralAssessments('migration-procedure', noEvidence, texts),
    ).toThrow('Missing evidence');

    const unsupported: BehavioralAssessment[] = structuredClone(assessments);
    unsupported[0]!.procedureSelection.evidence = [
      { file: 'src/search.ts', quote: 'the fixture has a live production API' },
    ];
    expect(() =>
      aggregateBehavioralAssessments('migration-procedure', unsupported, texts),
    ).toThrow('Evidence quote not found');

    const noRationale: BehavioralAssessment[] = structuredClone(assessments);
    noRationale[0]!.procedureSelection.rationale = '   ';
    expect(() =>
      aggregateBehavioralAssessments('migration-procedure', noRationale, texts),
    ).toThrow('Missing assessment rationale');
  });
});
