import { appendFileSync } from 'node:fs';

import { readPreviewBlogChanges } from '../../../scripts/preview-lifecycle';
import {
  baselineCandidatePaths,
  buildNarrationBaseline,
} from './preview-narration-baseline';

const required = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const context = {
  repository: required('GITHUB_REPOSITORY'),
  prNumber: required('PR_NUMBER'),
  approvedSha: required('APPROVED_SHA'),
};
const write = (key: string, value: string) =>
  appendFileSync(required('GITHUB_OUTPUT'), `${key}=${value}\n`);

const [, , command, clientOutput, mergeBase] = process.argv;
if (command === 'resolve') {
  const comparison = await readPreviewBlogChanges(
    { ...context, defaultBranch: required('DEFAULT_BRANCH') },
    {
      fetch: ((input, init) =>
        fetch(input, { ...init, redirect: 'error' })) as typeof fetch,
      githubToken: required('GH_TOKEN'),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (comparison?.posts.length) {
    write('merge-base', comparison.mergeBase);
    write('hash-paths', JSON.stringify(baselineCandidatePaths(comparison)));
  }
} else if (command === 'inventory' && clientOutput && mergeBase) {
  const paths: unknown = JSON.parse(required('BLOG_NARRATION_BASELINE_PATHS'));
  if (
    !Array.isArray(paths) ||
    paths.length >= 300 ||
    !paths.every((path) => typeof path === 'string')
  ) {
    throw new Error('Invalid baseline transcript path plan');
  }
  write(
    'inventory',
    await buildNarrationBaseline(
      clientOutput,
      {
        run: required('GITHUB_RUN_ID'),
        job: required('GITHUB_JOB'),
        attempt: required('GITHUB_RUN_ATTEMPT'),
        repository: context.repository,
        pull: context.prNumber,
        head: context.approvedSha,
        mergeBase,
      },
      paths,
    ),
  );
} else {
  throw new Error('Expected resolve or inventory <client output> <merge base>');
}
