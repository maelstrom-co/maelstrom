import { expect, test } from 'bun:test';
import { scriptedJudge } from './__test-helpers__/fake-planner.js';
import { silentLogger } from './__test-helpers__/fixtures.js';
import { gradeResponse } from './grader.js';
import { judgeEvidence, judgeProvenance } from './judge.js';
import {
  judgeFromGrader,
  renderJudgeSummary,
  summarizeJudges,
} from './judge-result.js';
import type { Judge } from './plugin.js';
import { selectScenarios } from './scenarios.js';

const context = { logger: silentLogger };
const custom = () =>
  scriptedJudge((input) => ({
    answers: Object.fromEntries(
      input.dimensions.map((dimension) => [
        dimension.name,
        { score: 0.7 * (dimension.levels.length - 1), probabilities: {} },
      ]),
    ),
    calls: [],
  }));

test('custom judges without provenance stay unknown for scored, failed and thrown verdicts', async () => {
  const judges: Judge[] = [
    custom(),
    scriptedJudge(() => ({ failure: 'PRIVATE provider failure', calls: [] })),
    scriptedJudge(() => {
      throw new Error('PRIVATE exception');
    }),
  ];
  const results = [];
  for (const judge of judges) {
    expect(judgeProvenance(judge)).toEqual({
      kind: 'unknown',
      provider: 'custom',
    });
    const result = await judgeEvidence(
      judge,
      'legacy_task',
      { assistantText: 'evidence' },
      context,
    );
    expect(result.provenance).toEqual({ kind: 'unknown', provider: 'custom' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    results.push(result);
  }
  expect(results[0]).toMatchObject({
    status: 'scored',
    scores: [{ value: 0.7 }],
  });
  expect(results[1]).toMatchObject({
    status: 'failed',
    reason: 'provider_failure',
  });
  expect(results[2]).toMatchObject({ status: 'failed', reason: 'exception' });
  expect(summarizeJudges(results)).toMatchObject({
    scored: 1,
    failed: 2,
    notRun: 0,
  });
});

test('explicit LLM and heuristic identities remain distinct from unknown custom summary groups', async () => {
  const provenances = [
    { kind: 'unknown', provider: 'custom' },
    { kind: 'llm', provider: 'custom', model: 'declared' },
    { kind: 'heuristic', provider: 'custom' },
  ] as const;
  const results = [];
  for (const provenance of provenances) {
    const judge: Judge =
      provenance.kind === 'unknown' ? custom() : { ...custom(), provenance };
    expect(judgeProvenance(judge)).toEqual(provenance);
    results.push(
      await judgeEvidence(
        judge,
        'legacy_task',
        { assistantText: 'evidence' },
        context,
      ),
    );
  }
  const summary = summarizeJudges(results);
  expect(summary.means.map((mean) => mean.provenance)).toEqual([
    ...provenances,
  ]);
  expect(summary.means.map((mean) => mean.count)).toEqual([1, 1, 1]);
  const rendered = renderJudgeSummary(summary);
  expect(rendered).toContain('(unknown, custom)');
  expect(rendered).toContain('(llm, custom/declared)');
  expect(rendered).toContain('(heuristic, custom)');
});

test('native grader conversion retains unknown custom provenance rather than historical or LLM classification', async () => {
  const judge = custom();
  const [scenario] = selectScenarios('all', ['preserve']);
  if (scenario.request.layout.type !== 'tiling')
    throw new Error('Expected tiling');
  const grade = await gradeResponse(
    judge,
    {
      request: scenario.request,
      response: {
        userMessage: 'same',
        executionPlan: [],
        tree: scenario.request.layout.tree,
        instances: scenario.request.instances,
      },
    },
    context,
  );
  const result = judgeFromGrader(grade, judgeProvenance(judge));
  expect(result).toMatchObject({
    status: 'scored',
    provenance: { kind: 'unknown', provider: 'custom' },
  });
  expect(
    summarizeJudges([result]).means.map((mean) => mean.provenance),
  ).toEqual([
    { kind: 'unknown', provider: 'custom' },
    { kind: 'unknown', provider: 'custom' },
  ]);
});
