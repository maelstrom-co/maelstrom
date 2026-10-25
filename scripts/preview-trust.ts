import type { PreviewGithubDependencies } from './preview-lifecycle.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const request = async (
  repository: string,
  path: string,
  dependencies: PreviewGithubDependencies,
) => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error('Repository must be an exact owner/name value');
  const token = dependencies.githubToken?.trim();
  if (!token) throw new Error('A GitHub token is required');
  const response = await dependencies.fetch(
    `https://api.github.com/repos/${repository}${path}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'maelstrom-preview-lifecycle',
      },
      redirect: 'error',
      signal: dependencies.signal ?? AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(
      `GitHub preview trust lookup returned HTTP ${response.status}`,
    );
  return (await response.json()) as unknown;
};

const userLogin = (value: unknown) =>
  isRecord(value) &&
  value.type === 'User' &&
  typeof value.login === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value.login)
    ? value.login
    : undefined;

const isMaintainer = async (
  repository: string,
  login: string,
  dependencies: PreviewGithubDependencies,
) => {
  const value = await request(
    repository,
    `/collaborators/${encodeURIComponent(login)}/permission`,
    dependencies,
  );
  if (value === undefined) return false;
  if (
    !isRecord(value) ||
    userLogin(value.user)?.toLowerCase() !== login.toLowerCase()
  )
    throw new Error('GitHub returned an invalid collaborator identity');
  // GitHub maps maintain to the legacy write permission. role_name keeps it distinct.
  return (
    (value.permission === 'admin' && value.role_name === 'admin') ||
    (value.permission === 'write' && value.role_name === 'maintain')
  );
};

/** Checks live maintainer authority without trusting commit identities or author associations. */
export const isMaintainerPreview = async (
  options: {
    readonly repository: string;
    readonly prNumber: string;
    readonly headSha: string;
    readonly baseBranch?: string;
    readonly actors?: readonly unknown[];
  },
  dependencies: PreviewGithubDependencies,
) => {
  if (!/^[1-9]\d*$/.test(options.prNumber))
    throw new Error('Pull request number must be a positive integer');
  if (!/^[0-9a-f]{40}$/.test(options.headSha))
    throw new Error('Head SHA must be a 40-character SHA');
  const pull = await request(
    options.repository,
    `/pulls/${options.prNumber}`,
    dependencies,
  );
  if (
    !isRecord(pull) ||
    pull.state !== 'open' ||
    !isRecord(pull.head) ||
    pull.head.sha !== options.headSha ||
    typeof pull.head.ref !== 'string' ||
    /^[0-9a-f]+$/i.test(pull.head.ref) ||
    !isRecord(pull.head.repo) ||
    pull.head.repo.full_name !== options.repository ||
    !Array.isArray(pull.labels) ||
    !pull.labels.some(
      (label) => isRecord(label) && label.name === 'deploy-preview',
    ) ||
    (options.baseBranch !== undefined &&
      (!isRecord(pull.base) ||
        pull.base.ref !== options.baseBranch ||
        !isRecord(pull.base.repo) ||
        pull.base.repo.full_name !== options.repository))
  )
    return false;
  const logins = [pull.user, ...(options.actors ?? [])].map(userLogin);
  if (logins.some((login) => login === undefined)) return false;
  for (const login of new Set(logins)) {
    if (
      !login ||
      !(await isMaintainer(options.repository, login, dependencies))
    )
      return false;
  }
  return true;
};

/** Selects only a successful, current same-repository CI run with live maintainer authority. */
export const selectMaintainerPreview = async (
  options: { readonly repository: string; readonly runId: string },
  dependencies: PreviewGithubDependencies,
) => {
  if (!/^[1-9]\d*$/.test(options.runId))
    throw new Error('CI run ID must be a positive integer');
  const run = await request(
    options.repository,
    `/actions/runs/${options.runId}`,
    dependencies,
  );
  if (
    !isRecord(run) ||
    String(run.id) !== options.runId ||
    run.name !== 'CI' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.event !== 'pull_request' ||
    !isRecord(run.repository) ||
    run.repository.full_name !== options.repository ||
    !Number.isSafeInteger(run.repository.id) ||
    !isRecord(run.head_repository) ||
    run.head_repository.full_name !== options.repository ||
    run.head_repository.id !== run.repository.id ||
    typeof run.head_sha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(run.head_sha) ||
    !Array.isArray(run.pull_requests) ||
    run.pull_requests.length !== 1
  )
    return undefined;
  const repository = await request(options.repository, '', dependencies);
  if (
    !isRecord(repository) ||
    repository.id !== run.repository.id ||
    repository.full_name !== options.repository ||
    typeof repository.default_branch !== 'string' ||
    repository.default_branch === ''
  )
    return undefined;
  const pull = run.pull_requests[0];
  if (
    !isRecord(pull) ||
    !Number.isSafeInteger(pull.number) ||
    Number(pull.number) < 1 ||
    !isRecord(pull.head) ||
    pull.head.sha !== run.head_sha ||
    pull.head.ref !== run.head_branch ||
    !isRecord(pull.head.repo) ||
    pull.head.repo.id !== run.repository.id ||
    !isRecord(pull.base) ||
    !isRecord(pull.base.repo) ||
    pull.base.repo.id !== run.repository.id ||
    pull.base.ref !== repository.default_branch
  )
    return undefined;
  const selected = { prNumber: String(pull.number), headSha: run.head_sha };
  return (await isMaintainerPreview(
    {
      ...selected,
      repository: options.repository,
      baseBranch: repository.default_branch,
      actors: [run.actor, run.triggering_actor],
    },
    dependencies,
  ))
    ? selected
    : undefined;
};
