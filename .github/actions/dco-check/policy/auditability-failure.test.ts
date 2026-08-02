import { describe, expect, it } from 'bun:test';
import { commit } from '../fixtures/commit.ts';
import { auditabilityFailure } from './auditability-failure.ts';
import type { CommitData } from './commit-data.ts';

describe('auditabilityFailure', () => {
  it('fails an empty commit list', () => {
    // Zero commits means the audit did not happen, not that it passed.
    expect(auditabilityFailure([])).toBe(
      'the pull-request commits endpoint returned no commits — refusing to pass a check that audited nothing',
    );
  });

  it('fails a pull request that reaches the API ceiling', () => {
    expect(auditabilityFailure(commits(250))).toBe(
      'this pull request exceeds the 250-commit API ceiling; only the first 250 commits could be audited — split the pull request',
    );
  });

  it('fails a pull request that would exceed the API ceiling', () => {
    expect(auditabilityFailure(commits(251))).toBe(
      'this pull request exceeds the 250-commit API ceiling; only the first 250 commits could be audited — split the pull request',
    );
  });

  it('passes a pull request one commit below the ceiling', () => {
    expect(auditabilityFailure(commits(249))).toBeUndefined();
  });

  it('passes an ordinary pull request', () => {
    expect(auditabilityFailure(commits(3))).toBeUndefined();
  });

  it('passes a single-commit pull request', () => {
    expect(auditabilityFailure([commit()])).toBeUndefined();
  });
});

function commits(count: number): CommitData[] {
  return Array.from({ length: count }, (_, index) =>
    commit({ sha: String(index).padStart(40, '0') }),
  );
}
