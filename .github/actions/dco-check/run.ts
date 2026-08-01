import type { Config } from './config/config.ts';
import { readConfig } from './config/read-config.ts';
import { type FetchCommits, fetchCommits } from './github/fetch-commits.ts';
import { type PostComment, postComment } from './github/post-comment.ts';
import { auditabilityFailure } from './policy/auditability-failure.ts';
import { checkCommits } from './policy/check-commits.ts';
import type { CommitData } from './policy/commit-data.ts';
import { renderComment } from './render/render-comment.ts';
import { unauditableBody } from './render/unauditable-body.ts';
import { annotateError } from './report/annotate-error.ts';
import { logVerdicts } from './report/log-verdicts.ts';

export function createRun({
  readConfig,
  fetchCommits,
  postComment,
  delay,
}: RunDependencies) {
  return async function run(): Promise<number> {
    const config = readConfig();
    const commits = await commitsToAudit(fetchCommits, delay, config);

    const unauditable =
      auditabilityFailure(commits) ?? headMismatch(commits, config.headSha);
    if (unauditable !== undefined) {
      annotateError(unauditable);
      const body = unauditableBody(unauditable);
      await postComment(config, body);
      return 1;
    }

    const verdicts = checkCommits(commits, config.isFork);
    logVerdicts(verdicts);

    // Rendered before `postComment`, which swallows delivery failures, so a
    // defect in the renderer fails the run rather than being reported as a
    // failure to post.
    const body = renderComment(verdicts, config.isFork);
    await postComment(config, body);

    return verdicts.some((verdict) => verdict.state === 'violation') ? 1 : 0;
  };
}

export type Run = ReturnType<typeof createRun>;

export const run = createRun({
  readConfig,
  fetchCommits,
  postComment,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

interface RunDependencies {
  readConfig: typeof readConfig;
  fetchCommits: FetchCommits;
  postComment: PostComment;
  delay: Delay;
}

type Delay = (ms: number) => Promise<void>;

async function commitsToAudit(
  fetchCommits: FetchCommits,
  delay: Delay,
  config: Config,
): Promise<CommitData[]> {
  const commits = await fetchCommits(config);
  if (commits.length > 0) {
    return commits;
  }
  // An empty list is retried once because nobody may be able to clear it
  // otherwise: none of the workflow's triggers self-fire, and a contributor
  // pushing from a fork cannot press "Re-run jobs". The second read failing
  // the same way still fails closed, just later.
  await delay(EMPTY_LIST_RETRY_MS);
  return fetchCommits(config);
}

// The commits endpoint answers oldest-first, so the last entry is the head of
// any pull request under the 250-commit ceiling — which is why this runs after
// the ceiling has been checked, not before. Should that ordering ever change,
// this fails closed with a diagnostic rather than passing the wrong range.
function headMismatch(
  commits: CommitData[],
  headSha: string,
): string | undefined {
  const audited = commits.at(-1)?.sha ?? '(none)';
  if (audited === headSha) {
    return undefined;
  }
  return `the audited commits end at ${audited}, not the ${headSha} this pull request points at — refusing to pass a check that audited a different commit range`;
}

const EMPTY_LIST_RETRY_MS = 2_000;
