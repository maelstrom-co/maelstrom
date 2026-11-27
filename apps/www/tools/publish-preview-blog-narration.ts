import {
  isPreviewComparisonCurrent,
  readApprovedWebsitePreview,
  readPreviewBlogChanges,
} from '../../../scripts/preview-lifecycle.ts';
import { previewNarrationBase } from '../src/lib/blog-narration-preview';
import { publishPreviewNarration } from './blog-narration-preview-publication';
import { compareNarrationBaseline } from './preview-narration-baseline';
import { putPreviewNarrationAsset } from './preview-narration-delivery';
import {
  narrationR2Client,
  readNarrationConfig,
  requiredNarrationSetting,
} from './publish-blog-narration';

const required = requiredNarrationSetting;

const prNumber = required('PR_NUMBER');
const approvedSha = required('APPROVED_SHA');
const origin = required('BLOG_NARRATION_PREVIEW_ORIGIN');
const deliveryBase = previewNarrationBase(origin, prNumber, approvedSha);
const cacheAccount = required('BLOG_NARRATION_R2_ACCOUNT_ID');
const deliveryAccount = required('BLOG_NARRATION_PREVIEW_R2_ACCOUNT_ID');
if (cacheAccount === deliveryAccount) {
  throw new Error(
    'Preview delivery and private narration cache require distinct accounts',
  );
}

const delivery = narrationR2Client(
  deliveryAccount,
  'BLOG_NARRATION_PREVIEW_R2',
);
const context = {
  repository: required('GITHUB_REPOSITORY'),
  prNumber,
  approvedSha,
  workersDevSuffix: required('PREVIEW_WORKERS_DEV_SUFFIX'),
};

const github = () => ({
  fetch: ((input, init) =>
    fetch(input, { ...init, redirect: 'error' })) as typeof fetch,
  githubToken: required('GH_TOKEN'),
  signal: AbortSignal.timeout(15_000),
});
const comparison = await readPreviewBlogChanges(
  { ...context, defaultBranch: required('DEFAULT_BRANCH') },
  github(),
).catch(() => undefined);
const maySynthesize = comparison
  ? compareNarrationBaseline(
      process.env.BLOG_NARRATION_BASELINE ?? '',
      {
        run: required('GITHUB_RUN_ID'),
        job: 'render-blog-narration-baseline',
        attempt: required('GITHUB_RUN_ATTEMPT'),
        repository: context.repository,
        pull: prNumber,
        head: approvedSha,
        mergeBase: comparison.mergeBase,
      },
      comparison.posts,
      comparison.removedPaths,
    )
  : undefined;
const outcome = await publishPreviewNarration({
  deliveryBase,
  report: (message) => console.log(message),
  readTarget: () => readApprovedWebsitePreview(context, github()),
  readPriorityPaths: async () =>
    comparison?.posts.map(({ path }) => path) ?? [],
  maySynthesize,
  async requireSynthesisCurrent() {
    if (
      !comparison ||
      !(await isPreviewComparisonCurrent(context, comparison.base, github()))
    ) {
      throw new Error('Preview narration comparison is no longer current');
    }
  },
  publication: readNarrationConfig(),
  deliver: (path, value, type) =>
    putPreviewNarrationAsset(delivery, path, value, type),
});
if (outcome.status === 'published') {
  const { published, skipped } = outcome;
  console.log(
    `Preview blog narration: ${published} published; ${skipped.older} archive-limit posts, ${skipped.download} download-limit posts, ${skipped.transcript} transcript-limit posts, ${skipped.budget} synthesis-budget posts, ${skipped.cacheOnly} cache-only posts skipped.`,
  );
} else {
  console.log(`Preview blog narration: ${outcome.status}`);
}
