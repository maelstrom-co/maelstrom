import { readConfig } from './config/read-config.ts';
import { fetchCommits } from './github/fetch-commits.ts';
import { postComment } from './github/post-comment.ts';
import { auditabilityFailure } from './policy/auditability-failure.ts';
import { checkCommits } from './policy/check-commits.ts';
import { renderComment } from './render/render-comment.ts';
import { annotateError } from './report/annotate-error.ts';
import { logVerdicts } from './report/log-verdicts.ts';

export async function run(): Promise<number> {
  const config = readConfig();
  const commits = await fetchCommits(config);

  const unauditable = auditabilityFailure(commits);
  if (unauditable !== undefined) {
    annotateError(unauditable);
    return 1;
  }

  const verdicts = checkCommits(commits);
  logVerdicts(verdicts);

  // Rendered before `postComment`, which swallows delivery failures, so a
  // defect in the renderer fails the run rather than being reported as a
  // failure to post.
  const body = renderComment(verdicts);
  await postComment(config, body);

  return verdicts.some((verdict) => verdict.state === 'violation') ? 1 : 0;
}
