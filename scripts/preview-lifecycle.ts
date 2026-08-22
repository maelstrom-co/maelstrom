import { appendFileSync } from 'node:fs';
import {
  type DeletePreviewWorkersOptions,
  deletePreviewWorkers,
  discoverPreviewPrNumbers,
} from './delete-preview-workers.ts';
import { validatePreviewWorkerUrl } from './preview-worker-url.ts';

const COMMENT_MARKER = '<!-- pr-preview-demo -->';
const STATE_PATTERN = /<!-- pr-preview-state (\{[^\n]*\}) -->/;
const LEGACY_DEPLOYED_PATTERN =
  /\*\*PR previews deployed\*\* for commit ([0-9a-f]{40})/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BOT_LOGIN = 'github-actions[bot]';

export type PreviewApp = 'demo' | 'docs' | 'www';
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

interface PreviewCommentState {
  readonly approvedSha?: string;
  readonly deployedSha?: string;
}

interface PullState {
  readonly state: 'open' | 'closed';
  readonly headSha: string;
  readonly headRef: string;
  readonly headRepository: string;
  readonly labeled: boolean;
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

const tokenFor = (dependencies: LifecycleDependencies) => {
  const token = dependencies.githubToken?.trim();
  if (!token) throw new Error('A GitHub token is required');
  return token;
};

const githubRequest = async (
  dependencies: LifecycleDependencies,
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
    { ...init, headers },
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
  dependencies: LifecycleDependencies,
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
  };
};

const parseCommentEnvelope = (value: unknown): PreviewComment[] => {
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
      comment.body.includes(COMMENT_MARKER) &&
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
  for (const section of header.split(',')) {
    const match = /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(section);
    if (match?.[2] === 'next') return match[1];
  }
  return undefined;
};

const readPreviewComment = async (
  repository: string,
  prNumber: string,
  dependencies: LifecycleDependencies,
) => {
  let path = `/issues/${prNumber}/comments?per_page=100`;
  let latest: PreviewComment | undefined;
  while (path) {
    const response = await githubRequest(dependencies, repository, path);
    const comments = parseCommentEnvelope(
      await responseJson(response, 'issue comments'),
    );
    latest = comments.at(-1) ?? latest;
    const next = nextLink(response.headers.get('link'));
    if (!next) break;
    const url = new URL(next);
    if (
      url.origin !== 'https://api.github.com' ||
      !url.pathname.startsWith(
        `/repos/${repository}/issues/${prNumber}/comments`,
      )
    ) {
      throw new Error(
        'GitHub returned an invalid issue comments pagination URL',
      );
    }
    path = `${url.pathname.replace(`/repos/${repository}`, '')}${url.search}`;
  }
  return latest;
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
  dependencies: LifecycleDependencies,
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

const stateMarker = (state: PreviewCommentState) =>
  `<!-- pr-preview-state ${JSON.stringify({ approvedSha: state.approvedSha, deployedSha: state.deployedSha })} -->`;

const updateApprovedMarker = (
  body: string,
  approvedSha: string,
  deployedSha?: string,
) => {
  const marker = stateMarker({ approvedSha, deployedSha });
  if (STATE_PATTERN.test(body)) return body.replace(STATE_PATTERN, marker);
  return body.replace(COMMENT_MARKER, `${COMMENT_MARKER}\n${marker}`);
};

export const renderDeployedComment = (state: {
  readonly approvedSha: string;
  readonly deployedSha: string;
  readonly demoUrl: string;
  readonly docsUrl: string;
  readonly wwwUrl: string;
}) => `${COMMENT_MARKER}
${stateMarker(state)}
**PR previews deployed** for commit ${state.deployedSha}

| App | Preview |
| --- | --- |
| Website | ${state.wwwUrl} |
| Documentation | ${state.docsUrl} |
| Demo | ${state.demoUrl} |

The demo is bring-your-own-key. This preview runs the approved PR branch code, so use a throwaway key or only open trusted previews.

Remove the \`deploy-preview\` label or close this PR to tear the preview down.`;

const renderApprovalComment = (approvedSha: string) => `${COMMENT_MARKER}
${stateMarker({ approvedSha })}
**PR preview approved** for commit ${approvedSha}.

The previous deployed preview remains available until this approved revision deploys successfully.`;

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
  dependencies: LifecycleDependencies,
) => ({
  pull: await readPull(repository, prNumber, dependencies),
  comment: await readPreviewComment(repository, prNumber, dependencies),
});

export const approvePreview = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly eventHeadSha: string;
  },
  dependencies: LifecycleDependencies,
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
  const body =
    comment && previous.deployedSha
      ? updateApprovedMarker(
          comment.body,
          options.eventHeadSha,
          previous.deployedSha,
        )
      : renderApprovalComment(options.eventHeadSha);
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

const readIntent = async (
  repository: string,
  prNumber: string,
  approvedSha: string,
  dependencies: LifecycleDependencies,
) => {
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
      !pull.labeled ||
      marker.approvedSha !== options.beforeSha
    ) {
      return 'stale-event' as const;
    }
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
) =>
  processEnvironment({
    ALCHEMY_PROFILE: 'preview-ci',
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken,
    PREVIEW_STAGE: `pr-${prNumber}`,
  });

const assertApprovedSourceRevision = async (
  sourceRoot: string,
  approvedSha: string,
  dependencies: LifecycleDependencies,
) => {
  const environment = processEnvironment({});
  const sourceHead = (
    await dependencies.runProcess({
      argv: ['/usr/bin/git', 'rev-parse', 'HEAD'],
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
      argv: ['/usr/bin/git', 'diff', '--quiet', 'HEAD', '--'],
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
      argv: ['/usr/bin/git', 'diff', '--cached', '--quiet', 'HEAD', '--'],
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
    readonly repository: string;
    readonly prNumber: string;
    readonly approvedSha: string;
    readonly bunExecutable: string;
    readonly sourceRoot: string;
    readonly accountId: string;
    readonly apiToken: string;
    readonly workersDevSuffix: string;
  },
  dependencies: LifecycleDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateSha('Approved SHA', options.approvedSha);
  validateBunExecutable(options.bunExecutable);
  const metadata = APP_METADATA[options.app];
  if (!metadata) throw new Error('Preview app must be demo, www, or docs');
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
  );
  const cwd = `${options.sourceRoot}/apps/${metadata.directory}`;
  const env = cloudflareEnvironment(
    options.accountId,
    options.apiToken,
    options.prNumber,
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

const validateDeploymentUrls = (
  prNumber: string,
  suffix: string,
  urls: {
    readonly demoUrl: string;
    readonly docsUrl: string;
    readonly wwwUrl: string;
  },
) => ({
  demoUrl: validatePreviewWorkerUrl(
    urls.demoUrl,
    `maelstrom-playground-alchemy-pr-${prNumber}`,
    suffix,
  ),
  docsUrl: validatePreviewWorkerUrl(
    urls.docsUrl,
    `maelstrom-docs-alchemy-pr-${prNumber}`,
    suffix,
  ),
  wwwUrl: validatePreviewWorkerUrl(
    urls.wwwUrl,
    `maelstrom-www-alchemy-pr-${prNumber}`,
    suffix,
  ),
});

export const finishPreviewDeployment = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly approvedSha: string;
    readonly bunExecutable: string;
    readonly sourceRoot: string;
    readonly accountId: string;
    readonly apiToken: string;
    readonly workersDevSuffix: string;
    readonly demoUrl: string;
  },
  dependencies: LifecycleDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateSha('Approved SHA', options.approvedSha);
  validateBunExecutable(options.bunExecutable);
  const demoUrl = validatePreviewWorkerUrl(
    options.demoUrl,
    `maelstrom-playground-alchemy-pr-${options.prNumber}`,
    options.workersDevSuffix,
  );
  const wwwUrl = await deployApp({ ...options, app: 'www' }, dependencies);
  const docsUrl = await deployApp({ ...options, app: 'docs' }, dependencies);
  const urls = validateDeploymentUrls(
    options.prNumber,
    options.workersDevSuffix,
    {
      demoUrl,
      docsUrl,
      wwwUrl,
    },
  );
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
  );
  const cleaned = await dependencies.deleteWorkers(
    {
      accountId: options.accountId,
      apiToken: options.apiToken,
      prNumber: options.prNumber,
      attempts: 1,
      workerScope: 'legacy',
    },
    async () => {
      await readIntent(
        options.repository,
        options.prNumber,
        options.approvedSha,
        dependencies,
      );
      return true;
    },
  );
  if (!cleaned) throw new Error('Legacy preview Worker cleanup failed');
  const intent = await readIntent(
    options.repository,
    options.prNumber,
    options.approvedSha,
    dependencies,
  );
  await upsertPreviewComment(
    options.repository,
    options.prNumber,
    intent.comment,
    renderDeployedComment({
      approvedSha: options.approvedSha,
      deployedSha: options.approvedSha,
      ...urls,
    }),
    dependencies,
  );
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
  return {
    scope: decideTeardownScope(trigger, {
      state: pull.state,
      sameRepository: pull.headRepository === repository,
      labeled: pull.labeled,
      headSha: pull.headSha,
      approvedSha,
    }),
    comment,
    staleLabeledApproval:
      pull.state === 'open' &&
      pull.headRepository === repository &&
      pull.labeled &&
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
    ? '**PR previews torn down.** The three known Alchemy preview stacks and exact preview Worker names were cleaned up.'
    : '**PR preview teardown incomplete.** At least one known Cloudflare cleanup operation failed. Retry this workflow before assuming cleanup finished.'
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
    readonly root: string;
  },
  dependencies: LifecycleDependencies,
) => {
  validateRepository(options.repository);
  validatePrNumber(options.prNumber);
  validateBunExecutable(options.bunExecutable);
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
    for (const app of ['docs', 'www', 'demo'] as const) {
      const live = await readTeardownPolicy(
        options.repository,
        options.prNumber,
        options.trigger,
        dependencies,
      );
      authority = narrowAuthority(authority, live.scope);
      if (authority !== 'all') continue;
      try {
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
  if (command === 'approve') {
    await approvePreview(
      {
        repository,
        prNumber,
        eventHeadSha: required(environment, 'EVENT_HEAD_SHA'),
      },
      dependencies,
    );
    return;
  }
  if (command === 'invalidate') {
    await invalidatePreviewApproval(
      {
        repository,
        prNumber,
        beforeSha: required(environment, 'EVENT_BEFORE_SHA'),
        afterSha: required(environment, 'EVENT_AFTER_SHA'),
      },
      dependencies,
    );
    return;
  }
  if (command === 'finish-deployment') {
    await finishPreviewDeployment(
      {
        repository,
        prNumber,
        approvedSha: required(environment, 'APPROVED_SHA'),
        bunExecutable: required(environment, 'BUN_EXECUTABLE'),
        sourceRoot: required(environment, 'SOURCE_ROOT'),
        accountId: required(environment, 'CLOUDFLARE_ACCOUNT_ID'),
        apiToken: required(environment, 'CLOUDFLARE_API_TOKEN'),
        workersDevSuffix: required(environment, 'PREVIEW_WORKERS_DEV_SUFFIX'),
        demoUrl: required(environment, 'DEMO_URL'),
      },
      dependencies,
    );
    return;
  }
  if (command === 'deploy-app') {
    const app = Bun.argv[3];
    if (app !== 'demo' && app !== 'docs' && app !== 'www') {
      throw new Error('deploy-app requires demo, www, or docs');
    }
    await deployPreviewApp(
      {
        app,
        repository,
        prNumber,
        approvedSha: required(environment, 'APPROVED_SHA'),
        bunExecutable: required(environment, 'BUN_EXECUTABLE'),
        sourceRoot: required(environment, 'SOURCE_ROOT'),
        accountId: required(environment, 'CLOUDFLARE_ACCOUNT_ID'),
        apiToken: required(environment, 'CLOUDFLARE_API_TOKEN'),
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
    'Usage: preview-lifecycle.ts approve|deploy-app|finish-deployment|invalidate|teardown|discover',
  );
};

if (import.meta.main) await cli();
