import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertWorkspaceAlchemyVersion,
  assertPreviewStateStore,
} from './alchemy-version.ts';
import {
  type DeletePreviewWorkersOptions,
  deletePreviewWorkers,
  discoverPreviewPrNumbers,
} from './delete-preview-workers.ts';
import {
  isMaintainerPreview,
  selectMaintainerPreview,
} from './preview-trust.ts';
import { validatePreviewWorkerUrl } from './preview-worker-url.ts';

const COMMENT_MARKER = '<!-- pr-preview-demo -->';
const APPROVAL_NOTICE_MARKER = '<!-- preview-approval-request -->';
export const VOICE_BENCHMARK_MARKER = '<!-- pr-voice-benchmark -->';
export const VOICE_BENCHMARK_ARCHIVE_MARKER =
  '<!-- pr-voice-benchmark-archive -->';
/** Job and step names in `deploy-preview.yml` that preview status reports look up through the workflow jobs API. */
export const DEPLOY_WORKFLOW_NAMES = {
  /** Records the approved head before any deploy of it can start. */
  approveJob: 'Record Preview Approval',
  /** Waits for the environment review, then builds and publishes the previews. */
  deployJob: 'Deploy Preview',
  /** The first deploy step that can publish a preview app. */
  firstPublishStep: 'Deploy demo preview',
} as const;
const STATE_PATTERN = /<!-- pr-preview-state (\{[^\n]*\}) -->/;
const LEGACY_DEPLOYED_PATTERN =
  /\*\*PR previews deployed\*\* for commit ([0-9a-f]{40})/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BOT_LOGIN = 'github-actions[bot]';

export type PreviewApp = 'demo' | 'agui-demo' | 'docs' | 'www';
export type TeardownScope = 'all' | 'legacy' | 'skip';
export type TeardownTrigger = 'closed' | 'manual' | 'schedule' | 'unlabeled';

export interface ProcessOptions {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface LifecycleDependencies {
  readonly fetch: typeof fetch;
  readonly githubToken?: string;
  readonly runProcess: (
    options: ProcessOptions,
  ) => Promise<{ readonly stdout: string }>;
  readonly deleteWorkers: (
    options: Omit<DeletePreviewWorkersOptions, 'authorize'>,
    authorize: (workerName: string) => Promise<boolean>,
  ) => Promise<boolean>;
  readonly discoverWorkers: (options: {
    readonly accountId: string;
    readonly apiToken: string;
  }) => Promise<readonly string[]>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly writeOutput: (name: string, value: string) => void;
}

export type PreviewGithubDependencies = Pick<
  LifecycleDependencies,
  'fetch' | 'githubToken'
> & { readonly signal?: AbortSignal };

interface PreviewCommentState {
  readonly approvedSha?: string;
  readonly deployedSha?: string;
}

const UNFINISHED_CI_CONCLUSIONS = {
  cancelled: 'cancelled',
  stale: 'stale',
  startup_failure: 'startup failure',
  timed_out: 'timed out',
} as const;

type UnfinishedCiConclusion = keyof typeof UNFINISHED_CI_CONCLUSIONS;

type PreviewProgress =
  | { readonly kind: 'awaiting-ci' | 'deploying' | 'ci-failed' }
  | {
      readonly kind: 'ci-unfinished';
      readonly conclusion: UnfinishedCiConclusion;
    }
  | { readonly kind: 'deploy-not-started'; readonly runUrl: string }
  | {
      readonly kind: 'deploy-cancelled' | 'deploy-failed';
      readonly runUrl: string;
      readonly publishStarted: boolean;
    };

interface WorkflowStep {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

interface WorkflowJob {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly steps?: readonly WorkflowStep[];
}

interface PullState {
  readonly state: 'open' | 'closed';
  readonly headSha: string;
  readonly headRef: string;
  readonly headRepository: string;
  readonly labeled: boolean;
  readonly benchmarkLabeled: boolean;
}

interface PreviewComment {
  readonly id: number;
  readonly body: string;
}

interface TeardownPolicyState {
  readonly state: 'open' | 'closed';
  readonly sameRepository: boolean;
  readonly labeled: boolean;
  readonly headSha: string;
  readonly approvedSha?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateRepository = (repository: string) => {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error('Repository must be an exact owner/name value');
  }
};

const validatePrNumber = (prNumber: string) => {
  if (!/^[1-9]\d*$/.test(prNumber)) {
    throw new Error('Pull request number must be a positive integer');
  }
};

const validateSha = (name: string, sha: string) => {
  if (!SHA_PATTERN.test(sha))
    throw new Error(`${name} must be a 40-character SHA`);
};

const validateRunId = (runId: string) => {
  if (!/^[1-9]\d*$/.test(runId)) {
    throw new Error('Workflow run ID must be a positive integer');
  }
};

const validateBunExecutable = (value: string) => {
  const ambiguous = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /\s/u.test(character) || codePoint <= 31 || codePoint === 127;
  });
  if (!value.startsWith('/') || ambiguous) {
    throw new Error(
      'Bun executable must be an absolute path without whitespace',
    );
  }
};

const required = (
  environment: Record<string, string | undefined>,
  name: string,
) => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const tokenFor = (dependencies: PreviewGithubDependencies) => {
  const token = dependencies.githubToken?.trim();
  if (!token) throw new Error('A GitHub token is required');
  return token;
};

const githubRequest = async (
  dependencies: PreviewGithubDependencies,
  repository: string,
  path: string,
  init: RequestInit = {},
) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${tokenFor(dependencies)}`);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  headers.set('User-Agent', 'maelstrom-preview-lifecycle');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await dependencies.fetch(
    `https://api.github.com/repos/${repository}${path}`,
    { ...init, headers, signal: dependencies.signal ?? init.signal },
  );
  if (!response.ok) {
    const detail = (await response.text())
      .replaceAll(/\s+/g, ' ')
      .slice(0, 500);
    throw new Error(
      `GitHub ${init.method ?? 'GET'} ${path} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }
  return response;
};

const responseJson = async (response: Response, context: string) => {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error(`GitHub returned invalid JSON for ${context}`);
  }
};

const readPull = async (
  repository: string,
  prNumber: string,
  dependencies: PreviewGithubDependencies,
): Promise<PullState> => {
  const response = await githubRequest(
    dependencies,
    repository,
    `/pulls/${prNumber}`,
  );
  const value = await responseJson(response, 'pull request');
  if (
    !isRecord(value) ||
    (value.state !== 'open' && value.state !== 'closed') ||
    !isRecord(value.head) ||
    typeof value.head.sha !== 'string' ||
    typeof value.head.ref !== 'string' ||
    !isRecord(value.head.repo) ||
    typeof value.head.repo.full_name !== 'string' ||
    !Array.isArray(value.labels) ||
    !value.labels.every(
      (label) => isRecord(label) && typeof label.name === 'string',
    )
  ) {
    throw new Error('GitHub returned an invalid pull request envelope');
  }
  validateSha('Live pull request head', value.head.sha);
  if (value.head.ref.trim() === '') {
    throw new Error('GitHub returned an invalid pull request branch');
  }
  return {
    state: value.state,
    headSha: value.head.sha,
    headRef: value.head.ref,
    headRepository: value.head.repo.full_name,
    labeled: value.labels.some((label) => label.name === 'deploy-preview'),
    benchmarkLabeled: value.labels.some(
      (label) => label.name === 'bench-voice',
    ),
  };
};

const parseCommentEnvelope = (
  value: unknown,
  marker = COMMENT_MARKER,
): PreviewComment[] => {
  if (!Array.isArray(value)) {
    throw new Error('GitHub returned an invalid issue comments envelope');
  }
  const comments: PreviewComment[] = [];
  for (const comment of value) {
    if (
      !isRecord(comment) ||
      !Number.isSafeInteger(comment.id) ||
      typeof comment.body !== 'string' ||
      !isRecord(comment.user) ||
      typeof comment.user.login !== 'string' ||
      typeof comment.user.type !== 'string'
    ) {
      throw new Error('GitHub returned an invalid issue comment');
    }
    if (
      comment.body.includes(marker) &&
      comment.user.login === BOT_LOGIN &&
      comment.user.type === 'Bot'
    ) {
      comments.push({ id: comment.id as number, body: comment.body });
    }
  }
  return comments;
};

const nextLink = (header: string | null) => {
  if (!header) return undefined;
  const links: string[] = [];
  for (const section of header.split(',')) {
    const match = /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(section);
    if (!match && /next/.test(section))
      throw new Error('Malformed GitHub pagination');
    if (match?.[2] === 'next' && match[1]) links.push(match[1]);
  }
  if (links.length > 1) throw new Error('Ambiguous GitHub pagination');
  return links[0];
};

const readGithubPages = async (
  repository: string,
  endpoint: string,
  dependencies: PreviewGithubDependencies,
) => {
  let path = `${endpoint}?per_page=100`;
  const visited = new Set<string>();
  const values: unknown[] = [];
  while (path) {
    if (visited.has(path) || visited.size >= 50)
      throw new Error('GitHub pagination is incomplete or cyclic');
    visited.add(path);
    const response = await githubRequest(dependencies, repository, path);
    const page = await responseJson(response, endpoint);
    if (!Array.isArray(page))
      throw new Error('GitHub returned an invalid paginated envelope');
    values.push(...page);
    const next = nextLink(response.headers.get('link'));
    if (!next) break;
    const url = new URL(next);
    const numericRepositoryPath = /^\/repositories\/[0-9]+(\/.*)$/.exec(
      url.pathname,
    );
    if (
      url.origin !== 'https://api.github.com' ||
      (url.pathname !== `/repos/${repository}${endpoint}` &&
        numericRepositoryPath?.[1] !== endpoint) ||
      url.username ||
      url.password
    )
      throw new Error(
        'GitHub returned an invalid issue comments pagination URL',
      );
    path = `${endpoint}${url.search}`;
  }
  return values;
};

const readPreviewComment = async (
  repository: string,
  prNumber: string,
  dependencies: PreviewGithubDependencies,
  marker = COMMENT_MARKER,
  strict = false,
) => {
  const comments = parseCommentEnvelope(
    await readGithubPages(
      repository,
      `/issues/${prNumber}/comments`,
      dependencies,
    ),
    marker,
  );
  if (strict && comments.length > 1)
    throw new Error('Multiple authoritative preview comments');
  return comments.at(-1);
};

const validateCommentResponse = async (response: Response) => {
  const value = await responseJson(response, 'updated preview comment');
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.id) ||
    typeof value.body !== 'string' ||
    !isRecord(value.user) ||
    value.user.login !== BOT_LOGIN ||
    value.user.type !== 'Bot'
  ) {
    throw new Error('GitHub returned an invalid updated preview comment');
  }
};

const upsertPreviewComment = async (
  repository: string,
  prNumber: string,
  existing: PreviewComment | undefined,
  body: string,
  dependencies: PreviewGithubDependencies,
) => {
  const path = existing
    ? `/issues/comments/${existing.id}`
    : `/issues/${prNumber}/comments`;
  const response = await githubRequest(dependencies, repository, path, {
    method: existing ? 'PATCH' : 'POST',
    body: JSON.stringify({ body }),
  });
  await validateCommentResponse(response);
};

export const parsePreviewComment = (body: string): PreviewCommentState => {
  if (!body.includes(COMMENT_MARKER)) return {};
  const stateMarkers = body.match(/<!-- pr-preview-state (\{[^\n]*\}) -->/g);
  if (stateMarkers && stateMarkers.length > 1) {
    throw new Error('Preview comment has multiple state markers');
  }
  const match = STATE_PATTERN.exec(body);
  if (!match && body.includes('<!-- pr-preview-state')) {
    throw new Error('Preview comment has an invalid state marker');
  }
  if (match?.[1]) {
    let value: unknown;
    try {
      value = JSON.parse(match[1]);
    } catch {
      throw new Error('Preview comment has an invalid state marker');
    }
    if (!isRecord(value))
      throw new Error('Preview comment state must be an object');
    if (
      Object.keys(value).some(
        (key) => key !== 'approvedSha' && key !== 'deployedSha',
      )
    ) {
      throw new Error('Preview comment state has an unknown field');
    }
    const approvedSha = value.approvedSha;
    const deployedSha = value.deployedSha;
    if (approvedSha !== undefined && typeof approvedSha !== 'string') {
      throw new Error('Preview comment approved SHA is invalid');
    }
    if (deployedSha !== undefined && typeof deployedSha !== 'string') {
      throw new Error('Preview comment deployed SHA is invalid');
    }
    if (approvedSha !== undefined) validateSha('Approved SHA', approvedSha);
    if (deployedSha !== undefined) validateSha('Deployed SHA', deployedSha);
    return { approvedSha, deployedSha };
  }
  const legacy = LEGACY_DEPLOYED_PATTERN.exec(body)?.[1];
  return { approvedSha: undefined, deployedSha: legacy };
};

export interface VoiceBenchmarkContext {
  readonly sha: string;
  readonly url: string;
  readonly requestId: number;
  readonly comment?: PreviewComment;
}

export interface VoiceBenchmarkOptions {
  readonly repository: string;
  readonly prNumber: string;
  readonly eventHeadSha?: string;
  readonly workersDevSuffix: string;
}

export const readVoiceBenchmarkContext = async (
  options: VoiceBenchmarkOptions,
  dependencies: PreviewGithubDependencies,
): Promise<VoiceBenchmarkContext | undefined> => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  if (options.eventHeadSha !== undefined)
    validateSha('Benchmark head SHA', options.eventHeadSha);
  const pull = await readPull(
    options.repository,
    options.prNumber,
    dependencies,
  );
  if (
    pull.state !== 'open' ||
    pull.headRepository !== options.repository ||
    (options.eventHeadSha !== undefined &&
      pull.headSha !== options.eventHeadSha) ||
    !pull.labeled ||
    !pull.benchmarkLabeled
  )
    return undefined;
  const preview = await readPreviewComment(
    options.repository,
    options.prNumber,
    dependencies,
    COMMENT_MARKER,
    true,
  );
  const state = preview ? parsePreviewComment(preview.body) : {};
  if (state.approvedSha !== pull.headSha || state.deployedSha !== pull.headSha)
    return undefined;
  const urls = [
    ...(preview?.body ?? '').matchAll(/^\| Demo \| ([^|\n]+) \|$/gm),
  ];
  if (urls.length !== 1 || !urls[0]?.[1])
    throw new Error('Approved demo URL is missing or ambiguous');
  const url = validatePreviewWorkerUrl(
    urls[0][1],
    `maelstrom-playground-alchemy-pr-${options.prNumber}`,
    options.workersDevSuffix,
  );
  const events = await readGithubPages(
    options.repository,
    `/issues/${options.prNumber}/events`,
    dependencies,
  );
  const seen = new Set<number>();
  const latest = new Map<string, { id: number; active: boolean }>();
  for (const event of events) {
    if (!isRecord(event) || typeof event.event !== 'string')
      throw new Error('Invalid label event envelope');
    if (event.event !== 'labeled' && event.event !== 'unlabeled') continue;
    if (!isRecord(event.label) || typeof event.label.name !== 'string')
      throw new Error('Invalid label event');
    if (!['deploy-preview', 'bench-voice'].includes(event.label.name)) continue;
    if (
      typeof event.id !== 'number' ||
      !Number.isSafeInteger(event.id) ||
      event.id < 1 ||
      seen.has(event.id)
    )
      throw new Error('Ambiguous benchmark label history');
    seen.add(event.id);
    const previous = latest.get(event.label.name);
    if (!previous || event.id > previous.id)
      latest.set(event.label.name, {
        id: event.id,
        active: event.event === 'labeled',
      });
  }
  const deployment = latest.get('deploy-preview');
  const benchmark = latest.get('bench-voice');
  if (!deployment || !benchmark)
    throw new Error('Benchmark label history is incomplete');
  if (!deployment.active || !benchmark.active) return undefined;
  const comment = await readPreviewComment(
    options.repository,
    options.prNumber,
    dependencies,
    VOICE_BENCHMARK_MARKER,
    true,
  );
  return {
    sha: pull.headSha,
    url,
    requestId: Math.max(deployment.id, benchmark.id),
    comment,
  };
};

export const saveVoiceBenchmarkComment = async (
  options: VoiceBenchmarkOptions,
  expected: VoiceBenchmarkContext,
  body: string,
  dependencies: PreviewGithubDependencies,
) => {
  if (!body.startsWith(`${VOICE_BENCHMARK_MARKER}\n`))
    throw new Error('Invalid voice benchmark comment');
  const current = await readVoiceBenchmarkContext(options, dependencies);
  if (
    !current ||
    current.sha !== expected.sha ||
    current.url !== expected.url ||
    current.requestId !== expected.requestId ||
    current.comment?.id !== expected.comment?.id ||
    current.comment?.body !== expected.comment?.body
  )
    throw new Error('Benchmark eligibility or claim changed');
  await upsertPreviewComment(
    options.repository,
    options.prNumber,
    current.comment,
    body,
    dependencies,
  );
};

const validateVoiceArchiveComment = (
  options: VoiceBenchmarkOptions,
  value: unknown,
): PreviewComment => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id < 1 ||
    typeof value.body !== 'string' ||
    !value.body.startsWith(`${VOICE_BENCHMARK_ARCHIVE_MARKER}\n`) ||
    value.body.includes(VOICE_BENCHMARK_MARKER) ||
    value.issue_url !==
      `https://api.github.com/repos/${options.repository}/issues/${options.prNumber}` ||
    !isRecord(value.user) ||
    value.user.login !== BOT_LOGIN ||
    value.user.type !== 'Bot'
  )
    throw new Error('Invalid voice benchmark archive comment');
  return { id: value.id, body: value.body };
};

/** Reads a referenced bot archive directly, verifying its repository and PR ownership. */
export const readVoiceBenchmarkArchive = async (
  options: VoiceBenchmarkOptions,
  commentId: number,
  dependencies: PreviewGithubDependencies,
): Promise<PreviewComment> => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  if (!Number.isSafeInteger(commentId) || commentId < 1)
    throw new Error('Invalid voice benchmark archive identity');
  const response = await githubRequest(
    dependencies,
    options.repository,
    `/issues/comments/${commentId}`,
  );
  const comment = validateVoiceArchiveComment(
    options,
    await responseJson(response, 'voice benchmark archive'),
  );
  if (comment.id !== commentId)
    throw new Error('Voice benchmark archive identity changed');
  return comment;
};

/** Appends an immutable archive; callers must durably reference it before dropping active history. */
export const createVoiceBenchmarkArchive = async (
  options: VoiceBenchmarkOptions,
  body: string,
  dependencies: PreviewGithubDependencies,
): Promise<PreviewComment> => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  if (
    !body.startsWith(`${VOICE_BENCHMARK_ARCHIVE_MARKER}\n`) ||
    body.includes(VOICE_BENCHMARK_MARKER)
  )
    throw new Error('Invalid voice benchmark archive body');
  const response = await githubRequest(
    dependencies,
    options.repository,
    `/issues/${options.prNumber}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    },
  );
  const comment = validateVoiceArchiveComment(
    options,
    await responseJson(response, 'created voice benchmark archive'),
  );
  if (comment.body !== body)
    throw new Error('Voice benchmark archive content changed');
  return comment;
};

const stateMarker = (state: PreviewCommentState) =>
  `<!-- pr-preview-state ${JSON.stringify({ approvedSha: state.approvedSha, deployedSha: state.deployedSha })} -->`;

export const renderDeployedComment = (state: {
  readonly repository: string;
  readonly approvedSha: string;
  readonly deployedSha: string;
  readonly demoUrl: string;
  readonly aguiUrl?: string;
  readonly docsUrl: string;
  readonly wwwUrl: string;
}) => `${renderPreviewHeader(state.repository, state)}

| App | Preview |
| --- | --- |
| Website | ${state.wwwUrl} |
| Documentation | ${state.docsUrl} |
| Demo | ${state.demoUrl} |${state.aguiUrl ? `\n| AG-UI demo | ${state.aguiUrl} |` : ''}

The demos are bring-your-own-key. These previews run the approved PR branch code, so use a throwaway key or only open trusted previews.

Remove the \`deploy-preview\` label or close this PR to tear the preview down.`;

const renderPreviewComment = (
  repository: string,
  existing: PreviewComment | undefined,
  state: PreviewCommentState,
  progress: PreviewProgress,
) => {
  const header = renderPreviewHeader(repository, state, progress);
  if (!state.deployedSha || !existing) return header;
  const detailsStart = existing.body.indexOf('\n\n');
  return detailsStart < 0
    ? header
    : `${header}${existing.body.slice(detailsStart)}`;
};

const renderPreviewHeader = (
  repository: string,
  state: PreviewCommentState,
  progress?: PreviewProgress,
) => {
  const lines = [COMMENT_MARKER, stateMarker(state)];
  const approved =
    state.approvedSha && commitLink(repository, state.approvedSha);
  if (state.deployedSha) {
    const deployed = commitLink(repository, state.deployedSha);
    lines.push(`✅ **Preview deployed** for ${deployed}`);
    if (approved && progress && state.approvedSha !== state.deployedSha)
      lines.push(renderProgressBesideDeployed(progress, approved, deployed));
  } else if (approved && progress) {
    lines.push(renderProgressHeadline(progress, approved));
  }
  return lines.join('\n');
};

const renderProgressHeadline = (
  progress: PreviewProgress,
  approved: string,
) => {
  switch (progress.kind) {
    case 'awaiting-ci':
      return `🟡 **Preview approved** for ${approved}, waiting for CI`;
    case 'deploying':
      return `🚀 **Deploying preview** for ${approved}`;
    case 'ci-failed':
      return `❌ CI failed on ${approved}, so no deploy is coming.`;
    case 'ci-unfinished':
      return `⚠️ CI did not finish on ${approved} (${UNFINISHED_CI_CONCLUSIONS[progress.conclusion]}), so no deploy is coming.`;
    case 'deploy-cancelled':
      return `${deployCancelledLead(approved)} ${rerunDeployLink(progress.runUrl)}`;
    case 'deploy-failed':
      return `${deployFailedLead(approved)} ([run](${progress.runUrl}))`;
    case 'deploy-not-started':
      return `${deployNotStartedLead(approved)} ([run](${progress.runUrl})).`;
  }
};

const renderProgressBesideDeployed = (
  progress: PreviewProgress,
  approved: string,
  deployed: string,
) => {
  const lastCompleteDeploy = `The last complete deploy is still ${deployed}.`;
  // The deploy job publishes the demo before the other apps, so a deploy that
  // reached publishing can leave the preview mixed.
  const afterStop = (publishStarted: boolean) =>
    publishStarted
      ? `Some preview apps may already run ${approved}.`
      : lastCompleteDeploy;
  switch (progress.kind) {
    case 'awaiting-ci':
      return `⏳ Newer commit ${approved} is waiting for CI. ${lastCompleteDeploy}`;
    case 'deploying':
      return renderProgressHeadline(progress, approved);
    case 'ci-failed':
    case 'ci-unfinished':
    case 'deploy-not-started':
      return `${renderProgressHeadline(progress, approved)} ${lastCompleteDeploy}`;
    case 'deploy-failed':
      return `${renderProgressHeadline(progress, approved)}. ${afterStop(progress.publishStarted)}`;
    case 'deploy-cancelled':
      return `${deployCancelledLead(approved)} ${afterStop(progress.publishStarted)} ${rerunDeployLink(progress.runUrl)}`;
  }
};

const deployFailedLead = (approved: string) =>
  `💥 **Preview deploy failed** for ${approved}`;

const deployCancelledLead = (approved: string) =>
  `⏸️ Deploy of ${approved} was cancelled.`;

const deployNotStartedLead = (approved: string) =>
  `🚫 Deploy of ${approved} did not start`;

const rerunDeployLink = (runUrl: string) =>
  `[Re-run the deploy](${runUrl}) to try again.`;

const commitLink = (repository: string, sha: string) =>
  `[${sha.slice(0, 7)}](https://github.com/${repository}/commit/${sha})`;

const assertApprovalEligible = (
  pull: PullState,
  repository: string,
  eventHeadSha: string,
) => {
  if (
    pull.state !== 'open' ||
    pull.headRepository !== repository ||
    pull.headSha !== eventHeadSha ||
    !pull.labeled
  ) {
    throw new Error(
      'Preview approval event no longer matches the live pull request',
    );
  }
  if (/^[0-9a-f]+$/i.test(pull.headRef)) {
    throw new Error('Preview approval rejects SHA-like branch names');
  }
};

const readApprovalSnapshot = async (
  repository: string,
  prNumber: string,
  dependencies: PreviewGithubDependencies,
) => ({
  pull: await readPull(repository, prNumber, dependencies),
  comment: await readPreviewComment(repository, prNumber, dependencies),
});

export const approvePreview = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly eventHeadSha: string;
    readonly progress: 'awaiting-ci' | 'deploying';
  },
  dependencies: PreviewGithubDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateSha('Event head SHA', options.eventHeadSha);
  const initial = await readApprovalSnapshot(
    options.repository,
    options.prNumber,
    dependencies,
  );
  assertApprovalEligible(
    initial.pull,
    options.repository,
    options.eventHeadSha,
  );
  const current = await readApprovalSnapshot(
    options.repository,
    options.prNumber,
    dependencies,
  );
  assertApprovalEligible(
    current.pull,
    options.repository,
    options.eventHeadSha,
  );
  const comment = current.comment;
  const previous = comment ? parsePreviewComment(comment.body) : {};
  const body = renderPreviewComment(
    options.repository,
    comment,
    { approvedSha: options.eventHeadSha, deployedSha: previous.deployedSha },
    { kind: options.progress },
  );
  // GitHub has no conditional comment PATCH. This final snapshot minimizes but
  // cannot eliminate a provider race between the read and write.
  await upsertPreviewComment(
    options.repository,
    options.prNumber,
    comment,
    body,
    dependencies,
  );
};

/** Records an automatic approval only after the trusted CI selector authorizes the current head. */
export const approveMaintainerPreview = async (
  options: { readonly repository: string; readonly runId: string },
  dependencies: LifecycleDependencies,
) => {
  const selected = await selectMaintainerPreview(options, dependencies);
  if (!selected) return false;
  await approvePreview(
    {
      repository: options.repository,
      prNumber: selected.prNumber,
      eventHeadSha: selected.headSha,
      progress: 'deploying',
    },
    dependencies,
  );
  dependencies.writeOutput('pr-number', selected.prNumber);
  dependencies.writeOutput('head-sha', selected.headSha);
  return true;
};

const readIntent = async (
  repository: string,
  prNumber: string,
  approvedSha: string,
  dependencies: LifecycleDependencies,
  ciRunId?: string,
) => {
  if (ciRunId !== undefined) {
    const selected = await selectMaintainerPreview(
      { repository, runId: ciRunId },
      dependencies,
    );
    if (selected?.prNumber !== prNumber || selected.headSha !== approvedSha)
      throw new Error('Automatic preview CI authority is no longer current');
  }
  const pull = await readPull(repository, prNumber, dependencies);
  const comment = await readPreviewComment(repository, prNumber, dependencies);
  const marker = comment ? parsePreviewComment(comment.body) : {};
  if (
    pull.state !== 'open' ||
    pull.headRepository !== repository ||
    pull.headSha !== approvedSha ||
    !pull.labeled ||
    marker.approvedSha !== approvedSha
  ) {
    throw new Error('Preview deployment approval is no longer current');
  }
  return { pull, comment, marker };
};

const deletePreviewLabel = async (
  repository: string,
  prNumber: string,
  dependencies: LifecycleDependencies,
) => {
  const response = await dependencies.fetch(
    `https://api.github.com/repos/${repository}/issues/${prNumber}/labels/deploy-preview`,
    {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${tokenFor(dependencies)}`,
        'User-Agent': 'maelstrom-preview-lifecycle',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (response.ok) return 'removed' as const;
  if (response.status === 404) return 'absent' as const;
  return 'failed' as const;
};

export const invalidatePreviewApproval = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly beforeSha: string;
    readonly afterSha: string;
    readonly actor?: string;
  },
  dependencies: LifecycleDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateSha('Before SHA', options.beforeSha);
  validateSha('After SHA', options.afterSha);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const pull = await readPull(
      options.repository,
      options.prNumber,
      dependencies,
    );
    const comment = await readPreviewComment(
      options.repository,
      options.prNumber,
      dependencies,
    );
    const marker = comment ? parsePreviewComment(comment.body) : {};
    if (marker.approvedSha === options.afterSha) return 'superseded' as const;
    if (
      pull.state !== 'open' ||
      pull.headRepository !== options.repository ||
      pull.headSha !== options.afterSha ||
      !pull.labeled
    ) {
      return 'stale-event' as const;
    }
    if (
      options.actor &&
      (await isMaintainerPreview(
        {
          repository: options.repository,
          prNumber: options.prNumber,
          headSha: options.afterSha,
          actors: [{ login: options.actor, type: 'User' }],
        },
        dependencies,
      ))
    ) {
      await approvePreview(
        {
          repository: options.repository,
          prNumber: options.prNumber,
          eventHeadSha: options.afterSha,
          progress: 'awaiting-ci',
        },
        dependencies,
      );
      return 'maintainer-update' as const;
    }
    const latest = await readApprovalSnapshot(
      options.repository,
      options.prNumber,
      dependencies,
    );
    if (
      latest.comment &&
      parsePreviewComment(latest.comment.body).approvedSha === options.afterSha
    )
      return 'superseded' as const;
    if (
      latest.pull.state !== 'open' ||
      latest.pull.headRepository !== options.repository ||
      latest.pull.headSha !== options.afterSha ||
      !latest.pull.labeled
    )
      return 'stale-event' as const;
    // GitHub offers no conditional label DELETE. Do not restore after this
    // request: that could override a maintainer's intentional unlabel.
    const result = await deletePreviewLabel(
      options.repository,
      options.prNumber,
      dependencies,
    );
    if (result !== 'failed') return 'removed' as const;
    if (attempt < 5) await dependencies.sleep(1_000 * 2 ** attempt);
  }
  throw new Error(
    'Could not remove stale preview approval after five attempts',
  );
};

const APP_METADATA = {
  demo: {
    directory: 'demo',
    stack: 'MaelstromDemoPreview',
    workerPrefix: 'maelstrom-playground-alchemy',
  },
  'agui-demo': {
    directory: 'agui-demo',
    stack: 'MaelstromAguiPreview',
    workerPrefix: 'maelstrom-agui-alchemy',
  },
  docs: {
    directory: 'docs',
    stack: 'MaelstromDocsPreview',
    workerPrefix: 'maelstrom-docs-alchemy',
  },
  www: {
    directory: 'www',
    stack: 'MaelstromWwwPreview',
    workerPrefix: 'maelstrom-www-alchemy',
  },
} as const;

const processEnvironment = (extra: Record<string, string>) => {
  const environment: Record<string, string> = { ...extra };
  for (const name of ['CI', 'HOME', 'PATH', 'XDG_CONFIG_HOME'] as const) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
};

const cloudflareEnvironment = (
  accountId: string,
  apiToken: string,
  prNumber: string,
  expectedAccountId: string,
) =>
  processEnvironment({
    ALCHEMY_PROFILE: 'preview-ci',
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken,
    EXPECTED_CLOUDFLARE_ACCOUNT_ID: expectedAccountId,
    PREVIEW_STAGE: `pr-${prNumber}`,
    ...(process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER
      ? {
          ALCHEMY_PREVIEW_STATE_STORE_WORKER:
            process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER,
        }
      : {}),
  });

/** Refuse to mutate when the credential's account is not the expected one. */
const assertExpectedAccount = (
  accountId: string,
  expectedAccountId: string,
) => {
  if (accountId !== expectedAccountId) {
    throw new Error(
      `Cloudflare account ${accountId} does not match the expected account`,
    );
  }
};

const assertApprovedSourceRevision = async (
  sourceRoot: string,
  approvedSha: string,
  dependencies: LifecycleDependencies,
) => {
  const environment = processEnvironment({});
  const sourceHead = (
    await dependencies.runProcess({
      argv: ['/usr/bin/git', '--no-replace-objects', 'rev-parse', 'HEAD'],
      cwd: sourceRoot,
      env: environment,
      timeoutMs: 10_000,
    })
  ).stdout.trim();
  if (sourceHead !== approvedSha) {
    throw new Error('Checked out source HEAD is not the approved SHA');
  }
  try {
    await dependencies.runProcess({
      argv: [
        '/usr/bin/git',
        '--no-replace-objects',
        'diff',
        '--quiet',
        'HEAD',
        '--',
      ],
      cwd: sourceRoot,
      env: environment,
      timeoutMs: 10_000,
    });
  } catch (error) {
    throw new Error('Approved source has tracked working-tree changes', {
      cause: error,
    });
  }
  try {
    await dependencies.runProcess({
      argv: [
        '/usr/bin/git',
        '--no-replace-objects',
        'diff',
        '--cached',
        '--quiet',
        'HEAD',
        '--',
      ],
      cwd: sourceRoot,
      env: environment,
      timeoutMs: 10_000,
    });
  } catch (error) {
    throw new Error('Approved source has staged changes', { cause: error });
  }
};

const deployApp = async (
  options: {
    readonly app: PreviewApp;
    readonly hasAgui: boolean;
    readonly repository: string;
    readonly prNumber: string;
    readonly approvedSha: string;
    readonly ciRunId?: string;
    readonly bunExecutable: string;
    readonly sourceRoot: string;
    readonly accountId: string;
    readonly apiToken: string;
    readonly expectedAccountId: string;
    readonly workersDevSuffix: string;
  },
  dependencies: LifecycleDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateSha('Approved SHA', options.approvedSha);
  validateBunExecutable(options.bunExecutable);
  assertExpectedAccount(options.accountId, options.expectedAccountId);
  const metadata = APP_METADATA[options.app];
  if (!metadata)
    throw new Error('Preview app must be demo, agui-demo, www, or docs');
  if (options.app === 'agui-demo' && !options.hasAgui)
    throw new Error('Approved source does not contain the AG-UI preview');
  await assertApprovedSourceRevision(
    options.sourceRoot,
    options.approvedSha,
    dependencies,
  );
  await readIntent(
    options.repository,
    options.prNumber,
    options.approvedSha,
    dependencies,
    options.ciRunId,
  );
  assertWorkspaceAlchemyVersion(
    options.sourceRoot,
    process.env.ALCHEMY_REQUIRED_VERSION,
    options.hasAgui,
  );
  assertPreviewStateStore(
    options.sourceRoot,
    process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER,
    options.hasAgui,
  );
  const cwd = `${options.sourceRoot}/apps/${metadata.directory}`;
  const env = cloudflareEnvironment(
    options.accountId,
    options.apiToken,
    options.prNumber,
    options.expectedAccountId,
  );
  await dependencies.runProcess({
    argv: [
      options.bunExecutable,
      'alchemy',
      'deploy',
      'alchemy.preview.run.ts',
      '--stage',
      `pr-${options.prNumber}`,
      '--profile',
      'preview-ci',
      '--yes',
    ],
    cwd,
    env,
    timeoutMs: 300_000,
  });
  const state = await dependencies.runProcess({
    argv: [
      options.bunExecutable,
      'alchemy',
      'state',
      'get',
      '../../infra/platform/state.run.ts',
      '--stack',
      metadata.stack,
      '--stage',
      `pr-${options.prNumber}`,
      '--fqn',
      'Website',
      '--profile',
      'preview-ci',
    ],
    cwd,
    env,
    timeoutMs: 60_000,
  });
  let value: unknown;
  try {
    value = JSON.parse(state.stdout);
  } catch {
    throw new Error('Alchemy preview state is not valid JSON');
  }
  if (
    !isRecord(value) ||
    !isRecord(value.attr) ||
    typeof value.attr.url !== 'string'
  ) {
    throw new Error('Alchemy preview state must contain a Worker URL');
  }
  const url = validatePreviewWorkerUrl(
    value.attr.url,
    `${metadata.workerPrefix}-pr-${options.prNumber}`,
    options.workersDevSuffix,
  );
  return url;
};

export const deployPreviewApp = async (
  options: Parameters<typeof deployApp>[0],
  dependencies: LifecycleDependencies,
) => {
  const url = await deployApp(options, dependencies);
  dependencies.writeOutput('deployment-url', url);
  return url;
};

export const finishPreviewDeployment = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly approvedSha: string;
    readonly ciRunId?: string;
    readonly bunExecutable: string;
    readonly sourceRoot: string;
    readonly accountId: string;
    readonly apiToken: string;
    readonly expectedAccountId: string;
    readonly workersDevSuffix: string;
    readonly demoUrl: string;
    readonly hasAgui: boolean;
  },
  dependencies: LifecycleDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateSha('Approved SHA', options.approvedSha);
  validateBunExecutable(options.bunExecutable);
  assertExpectedAccount(options.accountId, options.expectedAccountId);
  const demoUrl = validatePreviewWorkerUrl(
    options.demoUrl,
    `maelstrom-playground-alchemy-pr-${options.prNumber}`,
    options.workersDevSuffix,
  );
  // Capture the workflow-verified entrypoint before any source process runs.
  const retirementConfig = options.hasAgui
    ? undefined
    : await readFile(
        new URL(
          '../infra/platform/retire-agui-preview.run.ts',
          import.meta.url,
        ),
      );
  const wwwUrl = await deployApp({ ...options, app: 'www' }, dependencies);
  const docsUrl = await deployApp({ ...options, app: 'docs' }, dependencies);
  const aguiUrl = options.hasAgui
    ? await deployApp({ ...options, app: 'agui-demo' }, dependencies)
    : undefined;
  await assertApprovedSourceRevision(
    options.sourceRoot,
    options.approvedSha,
    dependencies,
  );
  await readIntent(
    options.repository,
    options.prNumber,
    options.approvedSha,
    dependencies,
    options.ciRunId,
  );
  if (retirementConfig) {
    // The old checkout has no AG-UI entrypoint. Use its verified platform CLI
    // with a trusted, empty stack declaration to destroy any prior PR state.
    assertWorkspaceAlchemyVersion(
      options.sourceRoot,
      process.env.ALCHEMY_REQUIRED_VERSION,
      false,
    );
    assertPreviewStateStore(
      options.sourceRoot,
      process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER,
      false,
    );
    const cwd = join(options.sourceRoot, 'infra/platform');
    const directory = await mkdtemp(join(cwd, '.retire-agui-'));
    try {
      const config = join(directory, 'retire.run.ts');
      await writeFile(config, retirementConfig, { flag: 'wx' });
      await dependencies.runProcess({
        argv: [
          options.bunExecutable,
          'alchemy',
          'destroy',
          config,
          '--stage',
          `pr-${options.prNumber}`,
          '--profile',
          'preview-ci',
          '--yes',
        ],
        env: cloudflareEnvironment(
          options.accountId,
          options.apiToken,
          options.prNumber,
          options.expectedAccountId,
        ),
        cwd,
        timeoutMs: 600_000,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  const cleaned = await dependencies.deleteWorkers(
    {
      accountId: options.accountId,
      apiToken: options.apiToken,
      prNumber: options.prNumber,
      attempts: 1,
      workerScope: options.hasAgui ? 'legacy' : 'legacy-and-agui',
    },
    async () => {
      await readIntent(
        options.repository,
        options.prNumber,
        options.approvedSha,
        dependencies,
        options.ciRunId,
      );
      return true;
    },
  );
  if (!cleaned) throw new Error('Superseded preview Worker cleanup failed');
  const intent = await readIntent(
    options.repository,
    options.prNumber,
    options.approvedSha,
    dependencies,
    options.ciRunId,
  );
  await upsertPreviewComment(
    options.repository,
    options.prNumber,
    intent.comment,
    renderDeployedComment({
      repository: options.repository,
      approvedSha: options.approvedSha,
      deployedSha: options.approvedSha,
      demoUrl,
      aguiUrl,
      docsUrl,
      wwwUrl,
    }),
    dependencies,
  );
};

/** Shows that CI on the approved head ended without success when no deployment of that head is coming. */
export const reportPreviewCiFailure = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly runId: string;
  },
  dependencies: PreviewGithubDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateRunId(options.runId);
  const unsuccessful = await readUnsuccessfulCiRun(
    options.repository,
    options.prNumber,
    options.runId,
    dependencies,
  );
  if (!unsuccessful) return false;
  return writeUndeployedApprovalProgress(
    options.repository,
    options.prNumber,
    unsuccessful.headSha,
    unsuccessful.progress,
    dependencies,
    // A deploy outcome keeps its run link until a newer attempt or head. A
    // label-triggered deploy does not depend on CI, and its approval write
    // lands before its notice, so its pending run also stands the report down.
    async (comment) =>
      reportsDeployOutcome(
        options.repository,
        comment.body,
        unsuccessful.headSha,
      ) ||
      (await hasPendingApprovalNotice(
        options.repository,
        options.prNumber,
        unsuccessful.headSha,
        dependencies,
      )) ||
      (await hasPendingLabelDeploy(
        options.repository,
        unsuccessful.headSha,
        dependencies,
      )),
  );
};

/** Shows why the approved head has no preview after its approval or deploy job stopped without success. */
export const reportPreviewDeployOutcome = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly approvedSha: string;
    readonly approveResult: string;
    readonly deployResult: string;
    readonly runId: string;
  },
  dependencies: PreviewGithubDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateSha('Approved SHA', options.approvedSha);
  validateRunId(options.runId);
  const progress = await readDeployOutcomeProgress(options, dependencies);
  return writeUndeployedApprovalProgress(
    options.repository,
    options.prNumber,
    options.approvedSha,
    progress,
    dependencies,
  );
};

/** Shows that the deploy job started for the approved head, replacing an earlier attempt's outcome when the job is re-run. */
export const reportPreviewDeployStart = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly approvedSha: string;
  },
  dependencies: PreviewGithubDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateSha('Approved SHA', options.approvedSha);
  return writeUndeployedApprovalProgress(
    options.repository,
    options.prNumber,
    options.approvedSha,
    { kind: 'deploying' },
    dependencies,
  );
};

const readUnsuccessfulCiRun = async (
  repository: string,
  prNumber: string,
  runId: string,
  dependencies: PreviewGithubDependencies,
): Promise<{ headSha: string; progress: PreviewProgress } | undefined> => {
  const run = await responseJson(
    await githubRequest(dependencies, repository, `/actions/runs/${runId}`),
    'CI run',
  );
  if (
    !isRecord(run) ||
    String(run.id) !== runId ||
    run.name !== 'CI' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.status !== 'completed' ||
    typeof run.conclusion !== 'string' ||
    (run.conclusion !== 'failure' &&
      !Object.hasOwn(UNFINISHED_CI_CONCLUSIONS, run.conclusion)) ||
    run.event !== 'pull_request' ||
    !isRecord(run.repository) ||
    run.repository.full_name !== repository ||
    !isRecord(run.head_repository) ||
    run.head_repository.full_name !== repository ||
    typeof run.head_sha !== 'string' ||
    !SHA_PATTERN.test(run.head_sha) ||
    !Array.isArray(run.pull_requests) ||
    run.pull_requests.length !== 1 ||
    !isRecord(run.pull_requests[0]) ||
    String(run.pull_requests[0].number) !== prNumber
  )
    return undefined;
  return {
    headSha: run.head_sha,
    progress:
      run.conclusion === 'failure'
        ? { kind: 'ci-failed' }
        : {
            kind: 'ci-unfinished',
            conclusion: run.conclusion as UnfinishedCiConclusion,
          },
  };
};

const hasPendingApprovalNotice = async (
  repository: string,
  prNumber: string,
  sha: string,
  dependencies: PreviewGithubDependencies,
) =>
  parseCommentEnvelope(
    await readGithubPages(
      repository,
      `/issues/${prNumber}/comments`,
      dependencies,
    ),
    APPROVAL_NOTICE_MARKER,
  ).some(
    (notice) =>
      notice.body.startsWith(APPROVAL_NOTICE_MARKER) &&
      notice.body.includes(sha),
  );

const reportsDeployOutcome = (
  repository: string,
  body: string,
  approvedSha: string,
) => {
  const approved = commitLink(repository, approvedSha);
  const headerEnd = body.indexOf('\n\n');
  return body
    .slice(0, headerEnd < 0 ? undefined : headerEnd)
    .split('\n')
    .some(
      (line) =>
        line.startsWith(deployFailedLead(approved)) ||
        line.startsWith(deployCancelledLead(approved)) ||
        line.startsWith(deployNotStartedLead(approved)),
    );
};

// The workflow also runs for other label events, and their benchmark job can
// wait for an environment review indefinitely. Only a run whose approval job
// ran and whose deploy job has not finished can still deploy the head.
const hasPendingLabelDeploy = async (
  repository: string,
  sha: string,
  dependencies: PreviewGithubDependencies,
) => {
  const value = await responseJson(
    await githubRequest(
      dependencies,
      repository,
      `/actions/workflows/deploy-preview.yml/runs?event=pull_request_target&head_sha=${sha}&per_page=100`,
    ),
    'deploy preview runs',
  );
  const runs = isRecord(value) ? value.workflow_runs : undefined;
  if (
    !Array.isArray(runs) ||
    !runs.every(
      (run) =>
        isRecord(run) &&
        Number.isSafeInteger(run.id) &&
        (run.id as number) > 0 &&
        typeof run.event === 'string' &&
        typeof run.head_sha === 'string' &&
        typeof run.status === 'string',
    )
  )
    throw new Error('GitHub returned an invalid workflow runs envelope');
  for (const run of runs) {
    if (
      run.event !== 'pull_request_target' ||
      run.head_sha !== sha ||
      run.status === 'completed'
    )
      continue;
    const jobs = await readWorkflowJobs(
      repository,
      String(run.id),
      dependencies,
    );
    if (awaitsLabelDeploy(jobs)) return true;
  }
  return false;
};

const awaitsLabelDeploy = (jobs: readonly WorkflowJob[]) => {
  const approve = jobs.find(
    (job) => job.name === DEPLOY_WORKFLOW_NAMES.approveJob,
  );
  if (!approve) return false;
  if (approve.status !== 'completed') return true;
  if (approve.conclusion !== 'success') return false;
  const deploy = jobs.find(
    (job) => job.name === DEPLOY_WORKFLOW_NAMES.deployJob,
  );
  return deploy?.status !== 'completed';
};

const readDeployOutcomeProgress = async (
  options: {
    readonly repository: string;
    readonly approveResult: string;
    readonly deployResult: string;
    readonly runId: string;
  },
  dependencies: PreviewGithubDependencies,
): Promise<PreviewProgress> => {
  const runUrl = `https://github.com/${options.repository}/actions/runs/${options.runId}`;
  // An approval job that stopped after recording the approval never let the
  // deploy job run, so nothing was published.
  if (options.approveResult === 'failure')
    return { kind: 'deploy-not-started', runUrl };
  if (options.approveResult === 'cancelled')
    return { kind: 'deploy-cancelled', runUrl, publishStarted: false };
  if (
    options.approveResult !== 'success' ||
    (options.deployResult !== 'failure' && options.deployResult !== 'cancelled')
  )
    throw new Error('Approval or deploy result must be failure or cancelled');
  const steps = (
    await readWorkflowJobs(options.repository, options.runId, dependencies)
  ).find((job) => job.name === DEPLOY_WORKFLOW_NAMES.deployJob)?.steps;
  // A rejected environment review or a cancelled wait ends the deploy job
  // before a runner starts it, so it has no steps.
  if (steps?.length === 0)
    return options.deployResult === 'failure'
      ? { kind: 'deploy-not-started', runUrl }
      : { kind: 'deploy-cancelled', runUrl, publishStarted: false };
  const publishStarted =
    steps?.find((step) => step.name === DEPLOY_WORKFLOW_NAMES.firstPublishStep)
      ?.conclusion !== 'skipped';
  return {
    kind:
      options.deployResult === 'failure' ? 'deploy-failed' : 'deploy-cancelled',
    runUrl,
    publishStarted,
  };
};

const readWorkflowJobs = async (
  repository: string,
  runId: string,
  dependencies: PreviewGithubDependencies,
): Promise<readonly WorkflowJob[]> => {
  const value = await responseJson(
    await githubRequest(
      dependencies,
      repository,
      `/actions/runs/${runId}/jobs?per_page=100`,
    ),
    'workflow jobs',
  );
  const jobs = isRecord(value) ? value.jobs : undefined;
  if (!Array.isArray(jobs) || !jobs.every(isWorkflowJob))
    throw new Error('GitHub returned an invalid workflow jobs envelope');
  return jobs;
};

const isWorkflowJob = (value: unknown): value is WorkflowJob =>
  hasNameAndStatus(value) &&
  (value.steps === undefined ||
    (Array.isArray(value.steps) && value.steps.every(hasNameAndStatus)));

const hasNameAndStatus = (
  value: unknown,
): value is WorkflowStep & Record<string, unknown> =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  typeof value.status === 'string' &&
  (value.conclusion === null || typeof value.conclusion === 'string');

const writeUndeployedApprovalProgress = async (
  repository: string,
  prNumber: string,
  approvedSha: string,
  progress: PreviewProgress,
  dependencies: PreviewGithubDependencies,
  keepCurrentStatus?: (comment: PreviewComment) => Promise<boolean>,
) => {
  let current = await readUndeployedApproval(
    repository,
    prNumber,
    approvedSha,
    dependencies,
  );
  if (!current) return false;
  if (keepCurrentStatus) {
    if (await keepCurrentStatus(current.comment)) return false;
    // The lookups only cleared the snapshot they started from, so any write
    // that landed during them stands the report down.
    const fresh = await readUndeployedApproval(
      repository,
      prNumber,
      approvedSha,
      dependencies,
    );
    if (!fresh || fresh.comment.body !== current.comment.body) return false;
    current = fresh;
  }
  const body = renderPreviewComment(
    repository,
    current.comment,
    current.marker,
    progress,
  );
  if (body === current.comment.body) return false;
  await upsertPreviewComment(
    repository,
    prNumber,
    current.comment,
    body,
    dependencies,
  );
  return true;
};

const readUndeployedApproval = async (
  repository: string,
  prNumber: string,
  approvedSha: string,
  dependencies: PreviewGithubDependencies,
) => {
  const { pull, comment } = await readApprovalSnapshot(
    repository,
    prNumber,
    dependencies,
  );
  const marker = comment ? parsePreviewComment(comment.body) : {};
  if (
    !comment ||
    pull.state !== 'open' ||
    pull.headRepository !== repository ||
    pull.headSha !== approvedSha ||
    !pull.labeled ||
    marker.approvedSha !== approvedSha ||
    marker.deployedSha === approvedSha
  )
    return undefined;
  return { comment, marker };
};

export const decideTeardownScope = (
  trigger: TeardownTrigger,
  state: TeardownPolicyState,
): TeardownScope => {
  const active =
    state.state === 'open' &&
    state.sameRepository &&
    state.labeled &&
    state.approvedSha === state.headSha;
  if (active) return trigger === 'schedule' ? 'legacy' : 'skip';
  return 'all';
};

const readTeardownPolicy = async (
  repository: string,
  prNumber: string,
  trigger: TeardownTrigger,
  dependencies: LifecycleDependencies,
) => {
  const pull = await readPull(repository, prNumber, dependencies);
  const comment = await readPreviewComment(repository, prNumber, dependencies);
  const marker = comment ? parsePreviewComment(comment.body) : {};
  const approvedSha = marker.approvedSha ?? marker.deployedSha;
  const pendingMaintainer =
    pull.state === 'open' &&
    pull.headRepository === repository &&
    pull.labeled &&
    approvedSha !== pull.headSha &&
    (await isMaintainerPreview(
      { repository, prNumber, headSha: pull.headSha },
      dependencies,
    ));
  return {
    scope: decideTeardownScope(trigger, {
      state: pull.state,
      sameRepository: pull.headRepository === repository,
      labeled: pull.labeled,
      headSha: pull.headSha,
      approvedSha: pendingMaintainer ? pull.headSha : approvedSha,
    }),
    comment,
    staleLabeledApproval:
      pull.state === 'open' &&
      pull.headRepository === repository &&
      pull.labeled &&
      !pendingMaintainer &&
      approvedSha !== pull.headSha,
  };
};

const narrowAuthority = (
  current: TeardownScope,
  live: TeardownScope,
): TeardownScope => {
  if (current === 'skip') return 'skip';
  if (current === 'legacy') return live === 'legacy' ? 'legacy' : 'skip';
  return live;
};

const renderTeardownComment = (complete: boolean) => `${COMMENT_MARKER}
${stateMarker({})}
${
  complete
    ? '🧹 **Preview removed.** The four known Alchemy preview stacks and exact preview Worker names were cleaned up.'
    : '⚠️ **Preview teardown incomplete.** At least one known Cloudflare cleanup operation failed. Retry this workflow before assuming cleanup finished.'
}

Re-add the \`deploy-preview\` label while the PR is open to create a new approval.`;

export const teardownPreview = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly trigger: TeardownTrigger;
    readonly bunExecutable: string;
    readonly accountId: string;
    readonly apiToken: string;
    readonly expectedAccountId: string;
    readonly root: string;
  },
  dependencies: LifecycleDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateBunExecutable(options.bunExecutable);
  assertExpectedAccount(options.accountId, options.expectedAccountId);
  if (
    !['closed', 'manual', 'schedule', 'unlabeled'].includes(options.trigger)
  ) {
    throw new Error('Invalid preview teardown trigger');
  }
  const initial = await readTeardownPolicy(
    options.repository,
    options.prNumber,
    options.trigger,
    dependencies,
  );
  let authority = initial.scope;
  if (authority === 'skip') return { scope: 'skip' as const, complete: true };
  const failures: string[] = [];
  if (
    authority === 'all' &&
    (options.trigger === 'schedule' || options.trigger === 'manual')
  ) {
    const live = await readTeardownPolicy(
      options.repository,
      options.prNumber,
      options.trigger,
      dependencies,
    );
    authority = narrowAuthority(authority, live.scope);
    if (authority === 'all' && live.staleLabeledApproval) {
      const result = await deletePreviewLabel(
        options.repository,
        options.prNumber,
        dependencies,
      );
      if (result === 'failed') {
        failures.push('Stale preview approval label removal failed');
      }
    }
  }
  if (authority === 'all') {
    for (const app of ['docs', 'www', 'agui-demo', 'demo'] as const) {
      const live = await readTeardownPolicy(
        options.repository,
        options.prNumber,
        options.trigger,
        dependencies,
      );
      authority = narrowAuthority(authority, live.scope);
      if (authority !== 'all') continue;
      try {
        assertWorkspaceAlchemyVersion(
          options.root,
          process.env.ALCHEMY_REQUIRED_VERSION,
          true,
        );
        assertPreviewStateStore(
          options.root,
          process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER,
          true,
        );
        await dependencies.runProcess({
          argv: [
            options.bunExecutable,
            'alchemy',
            'destroy',
            'alchemy.preview.run.ts',
            '--stage',
            `pr-${options.prNumber}`,
            '--profile',
            'preview-ci',
            '--yes',
          ],
          cwd: `${options.root}/apps/${APP_METADATA[app].directory}`,
          env: cloudflareEnvironment(
            options.accountId,
            options.apiToken,
            options.prNumber,
            options.expectedAccountId,
          ),
          timeoutMs: 600_000,
        });
      } catch (error) {
        failures.push(
          error instanceof Error ? error.message : `Failed to destroy ${app}`,
        );
      }
    }
  }
  if (authority !== 'skip') {
    const workerScope = authority;
    const deleted = await dependencies.deleteWorkers(
      {
        accountId: options.accountId,
        apiToken: options.apiToken,
        prNumber: options.prNumber,
        workerScope,
      },
      async (workerName) => {
        const live = await readTeardownPolicy(
          options.repository,
          options.prNumber,
          options.trigger,
          dependencies,
        );
        authority = narrowAuthority(authority, live.scope);
        return (
          authority === 'all' ||
          (authority === 'legacy' && !workerName.includes('-alchemy-'))
        );
      },
    );
    if (!deleted) failures.push('Exact preview Worker cleanup failed');
  }
  if (initial.scope === 'all') {
    const final = await readTeardownPolicy(
      options.repository,
      options.prNumber,
      options.trigger,
      dependencies,
    );
    authority = narrowAuthority(authority, final.scope);
    if (authority === 'all') {
      await upsertPreviewComment(
        options.repository,
        options.prNumber,
        final.comment,
        renderTeardownComment(failures.length === 0),
        dependencies,
      );
    }
  }
  return { scope: initial.scope, complete: failures.length === 0 };
};

export const discoverPreviews = async (
  options: { readonly accountId: string; readonly apiToken: string },
  dependencies: LifecycleDependencies,
) => {
  const candidates = await dependencies.discoverWorkers(options);
  if (candidates.length > 200) {
    throw new Error('Preview reconciliation found more than 200 candidates');
  }
  const value = JSON.stringify(candidates);
  dependencies.writeOutput('pr-numbers', value);
  return value;
};

const defaultRunProcess: LifecycleDependencies['runProcess'] = async (
  options,
) => {
  if (options.argv.length === 0)
    throw new Error('Process argv must not be empty');
  const child = Bun.spawn([...options.argv], {
    cwd: options.cwd,
    env: { ...options.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill(9);
  }, options.timeoutMs);
  try {
    const exitCode = await child.exited;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    if (timedOut) {
      throw new Error(`Process timed out after ${options.timeoutMs}ms`);
    }
    if (exitCode !== 0) {
      throw new Error(
        `Process ${options.argv[0]} exited ${exitCode}: ${stderr.replaceAll(/\s+/g, ' ').trim().slice(0, 1_000)}`,
      );
    }
    return { stdout };
  } finally {
    clearTimeout(timer);
  }
};

const githubOutput = (name: string, value: string) => {
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    appendFileSync(output, `${name}=${value}\n`);
  }
};

const defaultDependencies = (): LifecycleDependencies => ({
  fetch,
  githubToken: process.env.GH_TOKEN,
  runProcess: defaultRunProcess,
  deleteWorkers: (options, authorize) =>
    deletePreviewWorkers({ ...options, authorize }),
  discoverWorkers: (options) => discoverPreviewPrNumbers(options),
  sleep: (milliseconds) => Bun.sleep(milliseconds),
  writeOutput: githubOutput,
});

const cli = async () => {
  const command = Bun.argv[2];
  const environment = process.env;
  const dependencies = defaultDependencies();
  const repository = environment.GITHUB_REPOSITORY ?? '';
  const prNumber = environment.PR_NUMBER ?? '';
  const hasAgui = () => {
    const value = required(environment, 'HAS_AGUI_PREVIEW');
    if (value !== 'true' && value !== 'false')
      throw new Error('Invalid approved preview app selection');
    return value === 'true';
  };
  if (command === 'approve') {
    await approvePreview(
      {
        repository,
        prNumber,
        eventHeadSha: required(environment, 'EVENT_HEAD_SHA'),
        progress: 'deploying',
      },
      dependencies,
    );
    dependencies.writeOutput('pr-number', prNumber);
    dependencies.writeOutput(
      'head-sha',
      required(environment, 'EVENT_HEAD_SHA'),
    );
    return;
  }
  if (command === 'approve-ci') {
    if (
      !(await approveMaintainerPreview(
        { repository, runId: required(environment, 'CI_RUN_ID') },
        dependencies,
      ))
    ) {
      console.log('No current maintainer preview is eligible for this CI run');
    }
    return;
  }
  if (command === 'report-ci-failure') {
    if (
      !(await reportPreviewCiFailure(
        { repository, prNumber, runId: required(environment, 'CI_RUN_ID') },
        dependencies,
      ))
    ) {
      console.log('The unsuccessful CI run changed no preview status');
    }
    return;
  }
  if (command === 'report-deploy-outcome') {
    if (
      !(await reportPreviewDeployOutcome(
        {
          repository,
          prNumber,
          approvedSha: required(environment, 'APPROVED_SHA'),
          approveResult: required(environment, 'APPROVE_RESULT'),
          deployResult: required(environment, 'DEPLOY_RESULT'),
          runId: required(environment, 'GITHUB_RUN_ID'),
        },
        dependencies,
      ))
    ) {
      console.log('The deploy outcome has no current undeployed approval');
    }
    return;
  }
  if (command === 'report-deploy-start') {
    if (
      !(await reportPreviewDeployStart(
        {
          repository,
          prNumber,
          approvedSha: required(environment, 'APPROVED_SHA'),
        },
        dependencies,
      ))
    ) {
      console.log('The deploy start changed no preview status');
    }
    return;
  }
  if (command === 'invalidate') {
    await invalidatePreviewApproval(
      {
        repository,
        prNumber,
        beforeSha: required(environment, 'EVENT_BEFORE_SHA'),
        afterSha: required(environment, 'EVENT_AFTER_SHA'),
        actor: environment.GITHUB_ACTOR,
      },
      dependencies,
    );
    return;
  }
  if (command === 'finish-deployment') {
    await finishPreviewDeployment(
      {
        hasAgui: hasAgui(),
        repository,
        prNumber,
        approvedSha: required(environment, 'APPROVED_SHA'),
        ciRunId: environment.CI_RUN_ID || undefined,
        bunExecutable: required(environment, 'BUN_EXECUTABLE'),
        sourceRoot: required(environment, 'SOURCE_ROOT'),
        accountId: required(environment, 'CLOUDFLARE_ACCOUNT_ID'),
        apiToken: required(environment, 'CLOUDFLARE_API_TOKEN'),
        expectedAccountId: required(
          environment,
          'EXPECTED_CLOUDFLARE_ACCOUNT_ID',
        ),
        workersDevSuffix: required(environment, 'PREVIEW_WORKERS_DEV_SUFFIX'),
        demoUrl: required(environment, 'DEMO_URL'),
      },
      dependencies,
    );
    return;
  }
  if (command === 'deploy-app') {
    const app = Bun.argv[3];
    if (
      app !== 'demo' &&
      app !== 'agui-demo' &&
      app !== 'docs' &&
      app !== 'www'
    ) {
      throw new Error('deploy-app requires demo, agui-demo, www, or docs');
    }
    await deployPreviewApp(
      {
        hasAgui: hasAgui(),
        app,
        repository,
        prNumber,
        approvedSha: required(environment, 'APPROVED_SHA'),
        ciRunId: environment.CI_RUN_ID || undefined,
        bunExecutable: required(environment, 'BUN_EXECUTABLE'),
        sourceRoot: required(environment, 'SOURCE_ROOT'),
        accountId: required(environment, 'CLOUDFLARE_ACCOUNT_ID'),
        apiToken: required(environment, 'CLOUDFLARE_API_TOKEN'),
        expectedAccountId: required(
          environment,
          'EXPECTED_CLOUDFLARE_ACCOUNT_ID',
        ),
        workersDevSuffix: required(environment, 'PREVIEW_WORKERS_DEV_SUFFIX'),
      },
      dependencies,
    );
    return;
  }
  if (command === 'teardown') {
    const trigger = required(environment, 'PREVIEW_TRIGGER') as TeardownTrigger;
    const result = await teardownPreview(
      {
        repository,
        prNumber,
        trigger,
        bunExecutable: required(environment, 'BUN_EXECUTABLE'),
        accountId: required(environment, 'CLOUDFLARE_ACCOUNT_ID'),
        apiToken: required(environment, 'CLOUDFLARE_API_TOKEN'),
        expectedAccountId: required(
          environment,
          'EXPECTED_CLOUDFLARE_ACCOUNT_ID',
        ),
        root: process.cwd(),
      },
      dependencies,
    );
    if (!result.complete) process.exitCode = 1;
    return;
  }
  if (command === 'discover') {
    const value = await discoverPreviews(
      {
        accountId: required(environment, 'CLOUDFLARE_ACCOUNT_ID'),
        apiToken: required(environment, 'CLOUDFLARE_API_TOKEN'),
      },
      dependencies,
    );
    process.stdout.write(value);
    return;
  }
  throw new Error(
    'Usage: preview-lifecycle.ts approve|approve-ci|deploy-app|finish-deployment|invalidate|report-ci-failure|report-deploy-outcome|report-deploy-start|teardown|discover',
  );
};

if (import.meta.main) await cli();
