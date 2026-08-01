import { describe, expect, it } from 'bun:test';
import type { Config } from './config/config.ts';
import { capturedLog } from './fixtures/captured-log.ts';
import { commit } from './fixtures/commit.ts';
import { checkCommits } from './policy/check-commits.ts';
import type { CommitData } from './policy/commit-data.ts';
import { renderComment } from './render/render-comment.ts';
import { unauditableBody } from './render/unauditable-body.ts';
import { createRun } from './run.ts';

const HEAD_SHA = commit().sha;
const CONFIG: Config = {
  token: 'ghs_token',
  repository: 'maelstrom-co/maelstrom',
  prNumber: '7',
  headSha: HEAD_SHA,
  isFork: false,
};
const SIGNED = commit({
  message: 'feat: add a thing\n\nSigned-off-by: Ada Lovelace <ada@example.com>',
});
const NO_COMMITS =
  'the pull-request commits endpoint returned no commits — refusing to pass a check that audited nothing';
const OVER_CEILING =
  'this pull request exceeds the 250-commit API ceiling; only the first 250 commits could be audited — split the pull request';

describe('run', () => {
  it('passes a fully signed pull request', async () => {
    const posted: string[] = [];
    const { result } = await capturedLog(() => runWith([SIGNED], posted)());
    expect(result).toBe(0);
  });

  it('fails a pull request carrying a violation', async () => {
    const { result } = await capturedLog(() => runWith([commit()], [])());
    expect(result).toBe(1);
  });

  it('fails closed when the endpoint returned no commits', async () => {
    // An empty list is the endpoint answering before the merge ref exists, not
    // a pull request that passed — a check that audited nothing must not be
    // reported green.
    const posted: string[] = [];
    const { result, lines } = await capturedLog(() => runWith([], posted)());
    expect(result).toBe(1);
    expect(lines).toEqual([`::error title=DCO::${NO_COMMITS}`]);
    expect(posted).toEqual([unauditableBody(NO_COMMITS)]);
  });

  it('fails closed when the pull request exceeds the audit ceiling', async () => {
    // Every commit here is signed: the ceiling, not the sign-off, is what
    // decides this, because the API stops handing over commits at 250 and the
    // rest were never looked at.
    const posted: string[] = [];
    const { result, lines } = await capturedLog(() =>
      runWith(
        Array.from({ length: 250 }, () => SIGNED),
        posted,
      )(),
    );
    expect(result).toBe(1);
    expect(lines).toEqual([`::error title=DCO::${OVER_CEILING}`]);
    expect(posted).toEqual([unauditableBody(OVER_CEILING)]);
  });

  it('retries once when the endpoint answers with no commits', async () => {
    // The only failure a fork contributor could not clear themselves: none of
    // the workflow's triggers self-fire, and they cannot press "Re-run jobs".
    const delays: number[] = [];
    const responses: CommitData[][] = [[], [SIGNED]];
    const run = createRun({
      readConfig: () => CONFIG,
      fetchCommits: async () => responses.shift() ?? [],
      postComment: async () => {},
      delay: async (ms) => {
        delays.push(ms);
      },
    });
    const { result } = await capturedLog(() => run());
    expect(result).toBe(0);
    expect(delays).toEqual([2_000]);
    expect(responses).toEqual([]);
  });

  it('fails closed when the retry also returns no commits', async () => {
    const posted: string[] = [];
    const delays: number[] = [];
    const { result } = await capturedLog(() => runWith([], posted, delays)());
    expect(result).toBe(1);
    expect(delays).toEqual([2_000]);
    expect(posted).toEqual([unauditableBody(NO_COMMITS)]);
  });

  it('does not delay when the first read already carries commits', async () => {
    const delays: number[] = [];
    const { result } = await capturedLog(() => runWith([SIGNED], [], delays)());
    expect(result).toBe(0);
    expect(delays).toEqual([]);
  });

  it('fails closed when the audited commits do not end at the head', async () => {
    // A list that does not reach the head is a verdict about some other range
    // than the one branch protection is gating.
    const stale = 'a'.repeat(40);
    const reason = `the audited commits end at ${stale}, not the ${HEAD_SHA} this pull request points at — refusing to pass a check that audited a different commit range`;
    const posted: string[] = [];
    const { result, lines } = await capturedLog(() =>
      runWith([commit({ sha: stale, message: SIGNED.message })], posted)(),
    );
    expect(result).toBe(1);
    expect(lines).toEqual([`::error title=DCO::${reason}`]);
    expect(posted).toEqual([unauditableBody(reason)]);
  });

  it('reads the head as the last commit, the endpoint being oldest-first', async () => {
    const posted: string[] = [];
    const { result } = await capturedLog(() =>
      runWith(
        [commit({ sha: 'a'.repeat(40), message: SIGNED.message }), SIGNED],
        posted,
      )(),
    );
    expect(result).toBe(0);
  });

  it('hands the rendered body to postComment', async () => {
    // The rendering has to finish before the delivery starts — `postComment`
    // swallows delivery failures, so a renderer defect reached through it would
    // be reported as a failure to post rather than failing the run. Receiving
    // the finished body as an argument is what pins that order.
    const posted: string[] = [];
    const { result } = await capturedLog(() => runWith([commit()], posted)());
    expect(result).toBe(1);
    expect(posted).toEqual([
      renderComment(checkCommits([commit()], false), false),
    ]);
  });

  it('reads its configuration through the injected reader', async () => {
    const seen: Config[] = [];
    const run = createRun({
      readConfig: () => CONFIG,
      fetchCommits: async (config) => {
        seen.push(config);
        return [SIGNED];
      },
      postComment: async () => {},
      delay: async () => {},
    });
    await capturedLog(() => run());
    expect(seen).toEqual([CONFIG]);
  });

  it('lets an unreadable configuration fail the run', async () => {
    const run = createRun({
      readConfig: () => {
        throw new Error('REPOSITORY is required');
      },
      fetchCommits: async () => [SIGNED],
      postComment: async () => {},
      delay: async () => {},
    });
    await expect(run()).rejects.toThrow('REPOSITORY is required');
  });

  it('lets an unreachable commits endpoint fail the run', async () => {
    const run = createRun({
      readConfig: () => CONFIG,
      fetchCommits: async () => {
        throw new Error('403 Resource not accessible by integration');
      },
      postComment: async () => {},
      delay: async () => {},
    });
    await expect(run()).rejects.toThrow('Resource not accessible');
  });
});

function runWith(
  commits: CommitData[],
  posted: string[],
  delays: number[] = [],
) {
  return createRun({
    readConfig: () => CONFIG,
    fetchCommits: async () => commits,
    postComment: async (_config, body) => {
      posted.push(body);
    },
    delay: async (ms) => {
      delays.push(ms);
    },
  });
}
