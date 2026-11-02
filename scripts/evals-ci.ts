interface EvalsEnvironment {
  readonly [key: string]: string | undefined;
}

const REPORTS = [
  'planner',
  'select',
  'actions',
  'layout',
  'decisions-select',
  'decisions-actions',
  'decisions-layout',
] as const;

function github(env: EvalsEnvironment, fetcher: typeof fetch) {
  const repository = env.GITHUB_REPOSITORY ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !env.GH_TOKEN?.trim())
    throw new Error('GitHub repository and token are required');
  return async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetcher(
      `https://api.github.com/repos/${repository}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (method === 'DELETE' && response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`GitHub ${method} failed (${response.status})`);
    return response.status === 204 ? undefined : response.json();
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid GitHub response');
  return value as Record<string, unknown>;
}

function positiveId(value: unknown): string {
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new Error('Invalid GitHub identity');
  return text;
}

/** Checks the live PR against the immutable SHA captured by the label event. */
export async function checkEvalsRequest(
  env: EvalsEnvironment,
  fetcher = fetch,
): Promise<void> {
  if (env.GITHUB_RUN_ATTEMPT !== '1')
    throw new Error('Re-add run-evals instead of rerunning a paid evaluation');
  const pr = positiveId(env.PR_NUMBER);
  const sha = env.EXPECTED_SHA;
  if (!sha || !/^[a-f0-9]{40}$/.test(sha))
    throw new Error('An exact event SHA is required');
  const pull = object(await github(env, fetcher)(`/pulls/${pr}`));
  const head = object(pull.head);
  if (
    pull.state !== 'open' ||
    object(head.repo).full_name !== env.GITHUB_REPOSITORY
  )
    throw new Error('Evaluations require an open same-repository PR');
  if (head.sha !== sha)
    throw new Error(
      'Stale evaluation request: PR head advanced. Re-add run-evals for the new SHA.',
    );
}

/** Fails before evaluation work, without printing credential values. */
export function checkEvalsConfiguration(env: EvalsEnvironment): void {
  const missing = ['OPENAI_API_KEY', 'TYPESAFE_API_KEY', 'JEV_MODEL'].filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length)
    throw new Error(
      `Missing required eval configuration: ${missing.join(', ')}`,
    );
}

/**
 * Consumes only GitHub-owned run/artifact metadata on a fresh trusted runner.
 * Report content is never downloaded or executed alongside a write token.
 */
export async function finishEvalsRequest(
  env: EvalsEnvironment,
  fetcher = fetch,
): Promise<void> {
  const api = github(env, fetcher);
  const runId = positiveId(env.EVAL_RUN_ID);
  const run = object(await api(`/actions/runs/${runId}/attempts/1`));
  if (
    run.event !== 'pull_request_target' ||
    run.path !== '.github/workflows/evals.yml' ||
    object(run.head_repository).full_name !== env.GITHUB_REPOSITORY ||
    run.status !== 'completed' ||
    run.run_attempt !== 1
  )
    throw new Error('Refusing an untrusted or replayed evaluation run');
  // run-name is produced by the trusted target workflow, not PR code or an artifact.
  const request = /^Evals PR #([1-9]\d*) at ([a-f0-9]{40})$/.exec(
    typeof run.display_title === 'string' ? run.display_title : '',
  );
  if (!request) return;
  const pr = positiveId(request[1]);
  const sha = request[2];
  const pull = object(await api(`/pulls/${pr}`));
  if (object(object(pull.head).repo).full_name !== env.GITHUB_REPOSITORY)
    throw new Error('Refusing a fork evaluation result');

  // Cleanup precedes artifact discovery/commenting so a publication failure cannot retain the label.
  await api(`/issues/${pr}/labels/run-evals`, 'DELETE');
  const artifacts: { id: number; name: string; expired: boolean }[] = [];
  for (let page = 1; ; page++) {
    const result = object(
      await api(`/actions/runs/${runId}/artifacts?per_page=100&page=${page}`),
    );
    if (!Array.isArray(result.artifacts))
      throw new Error('Invalid artifact listing');
    for (const value of result.artifacts) {
      const artifact = object(value);
      if (
        typeof artifact.name !== 'string' ||
        typeof artifact.expired !== 'boolean'
      )
        throw new Error('Invalid artifact metadata');
      artifacts.push({
        id: Number(positiveId(artifact.id)),
        name: artifact.name,
        expired: artifact.expired,
      });
    }
    if (result.artifacts.length < 100) break;
    if (page >= 10) throw new Error('Too many evaluation artifacts');
  }
  const runUrl = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`;
  const links = REPORTS.map((name) => {
    const matches = artifacts.filter(
      (artifact) =>
        artifact.name === `eval-${name}-${runId}` && !artifact.expired,
    );
    return matches.length === 1
      ? `[${name}](${runUrl}/artifacts/${positiveId(matches[0]?.id)})`
      : `${name}: unavailable`;
  });
  const conclusion =
    typeof run.conclusion === 'string' &&
    [
      'success',
      'failure',
      'cancelled',
      'timed_out',
      'action_required',
      'skipped',
      'neutral',
      'stale',
    ].includes(run.conclusion)
      ? run.conclusion
      : 'unknown';
  await api(`/issues/${pr}/comments`, 'POST', {
    body: [
      `Evals for \`${sha}\`: **${conclusion}**. [Run ${runId}](${runUrl}). Scores are informational; setup/runtime errors fail the job.`,
      links.join(' · '),
      'The run-evals label was consumed. Re-add it for a new approved attempt. Missing reports mean that evaluation did not finish or its artifact is unavailable.',
    ].join('\n\n'),
  });
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === 'check') await checkEvalsRequest(process.env);
  else if (command === 'configuration') checkEvalsConfiguration(process.env);
  else if (command === 'finish') await finishEvalsRequest(process.env);
  else throw new Error('Expected check, configuration or finish');
}
