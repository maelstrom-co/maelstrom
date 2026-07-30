import { describe, expect, it } from 'bun:test';
import { commit } from '../fixtures/commit.ts';
import { renderComment } from './render-comment.ts';
import { signed } from './test-helpers/signed.ts';

describe('passBody', () => {
  it('reports the signed count on a pass', () => {
    const body = renderComment([signed, signed, signed]);
    expect(body).toContain('all 3 commits');
    expect(body).toContain('✓');
  });

  it('omits the exempt parenthetical when nothing was exempt', () => {
    const body = renderComment([signed]);
    expect(body).toContain('the single commit carries');
    expect(body).not.toContain('exempt');
  });

  it('names only the exemption categories that occurred', () => {
    const body = renderComment([
      signed,
      {
        commit: commit({ parentCount: 2 }),
        state: 'exempt',
        reason: 'merge-commit',
      },
    ]);
    expect(body).toContain('(1 exempt: merge commits)');
    expect(body).not.toContain('bot authors');
  });

  it('lists both exemption categories when both occurred', () => {
    const body = renderComment([
      signed,
      {
        commit: commit({ parentCount: 2 }),
        state: 'exempt',
        reason: 'merge-commit',
      },
      {
        commit: commit({ authorLogin: 'dependabot[bot]', authorType: 'Bot' }),
        state: 'exempt',
        reason: 'bot-author',
      },
    ]);
    expect(body).toContain('(2 exempt: merge commits, bot authors)');
  });

  it('says nothing required a sign-off when every commit was exempt', () => {
    const body = renderComment([
      {
        commit: commit({ authorLogin: 'dependabot[bot]', authorType: 'Bot' }),
        state: 'exempt',
        reason: 'bot-author',
      },
    ]);
    expect(body).toContain(
      '**DCO** ✓ no commit required a sign-off. (1 exempt: bot authors)',
    );
    expect(body).not.toContain('all 0 commits');
  });

  it('says nothing required a sign-off when there are no commits at all', () => {
    const body = renderComment([]);
    expect(body).toContain('**DCO** ✓ no commit required a sign-off.');
    expect(body).not.toContain('all 0 commits');
    expect(body).not.toContain('✗');
  });
});
