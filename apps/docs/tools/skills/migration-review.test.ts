import { expect, test } from 'bun:test';
import { migrationReview } from './migration-review';

test('independent review approval binds both frozen source submissions and never returns its rationale', () => {
  const seal = '1'.repeat(64);
  const submissions = {
    baseline: { sourceHash: '2'.repeat(64) },
    treatment: { sourceHash: '3'.repeat(64) },
  };
  const document = {
    version: 1,
    seal,
    reviewer: { id: 'external-reviewer', independent: true },
    arms: {
      baseline: {
        ...submissions.baseline,
        behaviorallyRelevant: true,
        rationale:
          'The test observes the supplied connector through rendered behavior.',
      },
      treatment: {
        ...submissions.treatment,
        behaviorallyRelevant: true,
        rationale:
          'The test observes the supplied connector through rendered behavior.',
      },
    },
  };
  expect(migrationReview(undefined, seal, submissions).status).toBe('pending');
  const approved = migrationReview(JSON.stringify(document), seal, submissions);
  expect(approved.status).toBe('approved');
  expect(JSON.stringify(approved)).not.toContain('rationale');
  expect(
    migrationReview(JSON.stringify(document), '4'.repeat(64), submissions)
      .status,
  ).toBe('stale');
  expect(
    migrationReview(JSON.stringify(document), seal, {
      ...submissions,
      treatment: { sourceHash: '4'.repeat(64) },
    }).status,
  ).toBe('stale');
  document.arms.treatment.behaviorallyRelevant = false;
  expect(
    migrationReview(JSON.stringify(document), seal, submissions).status,
  ).toBe('rejected');
  document.reviewer.independent = false;
  expect(
    migrationReview(JSON.stringify(document), seal, submissions).status,
  ).toBe('invalid');
  expect(migrationReview('{', seal, submissions).status).toBe('invalid');
});
