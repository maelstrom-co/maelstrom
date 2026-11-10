import { expect, test } from 'bun:test';

import {
  checkEvalsConfiguration,
  checkEvalsRequest,
  finishEvalsRequest,
} from './evals-ci.ts';

const repository = 'maelstrom-co/maelstrom';
const sha = 'a'.repeat(40);
const env = {
  GITHUB_REPOSITORY: repository,
  GH_TOKEN: 'synthetic-token',
  GITHUB_RUN_ATTEMPT: '1',
  PR_NUMBER: '42',
  EXPECTED_SHA: sha,
  EVAL_RUN_ID: '123',
};
const reportNames = [
  'planner',
  'select',
  'actions',
  'layout',
  'decisions-select',
  'decisions-actions',
  'decisions-layout',
];
function fixture() {
  const state = {
    pull: { state: 'open', head: { sha, repo: { full_name: repository } } },
    run: {
      event: 'pull_request_target',
      path: '.github/workflows/evals.yml',
      status: 'completed',
      head_repository: { full_name: repository },
      run_attempt: 1,
      display_title: `Evals PR #42 at ${sha}`,
      conclusion: 'success',
    },
    artifacts: reportNames.map((name, index) => ({
      id: index + 1,
      name: `eval-${name}-123`,
      expired: false,
    })),
    deleteStatus: 204,
    artifactStatus: 200,
    commentStatus: 201,
    calls: [] as string[],
    comments: [] as string[],
  };
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      state.calls.push(`${method} ${url.pathname}${url.search}`);
      expect(url.origin).toBe('https://api.github.com');
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer synthetic-token',
      );
      if (url.pathname.endsWith('/pulls/42')) return Response.json(state.pull);
      if (url.pathname.endsWith('/actions/runs/123/attempts/1'))
        return Response.json(state.run);
      if (url.pathname.endsWith('/labels/run-evals') && method === 'DELETE')
        return new Response(null, { status: state.deleteStatus });
      if (url.pathname.endsWith('/artifacts')) {
        const page = Number(url.searchParams.get('page'));
        return Response.json(
          { artifacts: state.artifacts.slice((page - 1) * 100, page * 100) },
          { status: state.artifactStatus },
        );
      }
      if (url.pathname.endsWith('/comments') && method === 'POST') {
        state.comments.push(JSON.parse(String(init?.body)).body);
        return Response.json({}, { status: state.commentStatus });
      }
      throw new Error(`Unexpected API request ${method} ${url}`);
    },
    globalThis.fetch,
  );
  return { state, fetcher };
}

test('requires all provider configuration and never prints values', () => {
  expect(() => checkEvalsConfiguration({})).toThrow(
    'OPENAI_API_KEY, TYPESAFE_API_KEY, JEV_MODEL',
  );
  expect(() =>
    checkEvalsConfiguration({
      OPENAI_API_KEY: 'secret',
      TYPESAFE_API_KEY: ' ',
      JEV_MODEL: 'model',
    }),
  ).toThrow('Missing required eval configuration: TYPESAFE_API_KEY');
  expect(() =>
    checkEvalsConfiguration({
      OPENAI_API_KEY: 'secret',
      TYPESAFE_API_KEY: 'secret',
      JEV_MODEL: 'model',
    }),
  ).not.toThrow();
});

test('validates the exact current SHA without revoking an independently queued label request', async () => {
  const { state, fetcher } = fixture();
  await checkEvalsRequest(env, fetcher);
  expect(state.calls).toHaveLength(1);
  state.pull.head.sha = 'b'.repeat(40);
  await expect(checkEvalsRequest(env, fetcher)).rejects.toThrow(
    'Stale evaluation request',
  );
  state.pull.head.sha = sha;
  state.pull.head.repo.full_name = 'fork/repo';
  await expect(checkEvalsRequest(env, fetcher)).rejects.toThrow(
    'same-repository',
  );
  state.pull.head.repo.full_name = repository;
  state.pull.state = 'closed';
  await expect(checkEvalsRequest(env, fetcher)).rejects.toThrow('open');
});

test('refuses reruns and malformed identities before accessing GitHub', async () => {
  const { state, fetcher } = fixture();
  for (const overrides of [
    { GITHUB_RUN_ATTEMPT: '2' },
    { PR_NUMBER: '../43' },
    { EXPECTED_SHA: 'main' },
    { GITHUB_REPOSITORY: 'bad/path/extra' },
  ])
    await expect(
      checkEvalsRequest({ ...env, ...overrides }, fetcher),
    ).rejects.toThrow();
  expect(state.calls).toEqual([]);
});

test.each([
  'success',
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'skipped',
])(
  'consumes the label and creates seven links after %s',
  async (conclusion) => {
    const { state, fetcher } = fixture();
    state.run.conclusion = conclusion;
    // Advancement or closure after execution must not block cleanup of the original request.
    state.pull.head.sha = 'b'.repeat(40);
    state.pull.state = 'closed';
    await finishEvalsRequest(env, fetcher);
    expect(
      state.calls.findIndex((call) => call.startsWith('DELETE')),
    ).toBeLessThan(
      state.calls.findIndex((call) => call.includes('/artifacts')),
    );
    expect(state.comments).toHaveLength(1);
    const body = state.comments[0]!;
    expect(body).toContain(`\`${sha}\`: **${conclusion}**`);
    for (const [index, name] of reportNames.entries())
      expect(body).toContain(
        `[${name}](https://github.com/${repository}/actions/runs/123/artifacts/${index + 1})`,
      );
    expect(state.calls.filter((call) => call.startsWith('POST'))).toHaveLength(
      1,
    );
    expect(state.calls.some((call) => call.startsWith('PATCH'))).toBe(false);
  },
);

test('missing, expired, duplicate and unrelated artifacts are not trusted report links', async () => {
  const { state, fetcher } = fixture();
  state.deleteStatus = 404;
  state.artifacts = [
    { id: 1, name: 'eval-planner-123', expired: true },
    { id: 2, name: 'eval-select-123', expired: false },
    { id: 3, name: 'eval-select-123', expired: false },
    { id: 4, name: 'eval-layout-999', expired: false },
    { id: 5, name: '[evil](https://evil.invalid)', expired: false },
  ];
  await finishEvalsRequest(env, fetcher);
  for (const name of reportNames)
    expect(state.comments[0]).toContain(`${name}: unavailable`);
  expect(state.comments[0]).not.toContain('evil');
  expect(state.comments[0]).not.toContain('/artifacts/');
});

test('artifact discovery paginates without downloading content', async () => {
  const { state, fetcher } = fixture();
  const reports = state.artifacts;
  state.artifacts = [
    ...Array.from({ length: 100 }, (_, id) => ({
      id: id + 100,
      name: 'unrelated',
      expired: false,
    })),
    ...reports,
  ];
  await finishEvalsRequest(env, fetcher);
  expect(state.calls.some((call) => call.endsWith('page=2'))).toBe(true);
  expect(state.comments[0]).toContain('[planner](');
});

test('label removal happens even when artifacts or comments fail', async () => {
  for (const failure of ['artifactStatus', 'commentStatus'] as const) {
    const { state, fetcher } = fixture();
    state[failure] = 500;
    await expect(finishEvalsRequest(env, fetcher)).rejects.toThrow('GitHub');
    expect(state.calls.some((call) => call.startsWith('DELETE'))).toBe(true);
  }
});

test('unauthorized runs and forks cannot mutate PRs', async () => {
  for (const override of [
    { event: 'pull_request' },
    { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'fork/repo' } },
    { status: 'in_progress' },
    { run_attempt: 2 },
  ]) {
    const { state, fetcher } = fixture();
    Object.assign(state.run, override);
    await expect(finishEvalsRequest(env, fetcher)).rejects.toThrow('untrusted');
    expect(state.calls.every((call) => call.startsWith('GET'))).toBe(true);
  }
  const { state, fetcher } = fixture();
  state.pull.head.repo.full_name = 'fork/repo';
  await expect(finishEvalsRequest(env, fetcher)).rejects.toThrow('fork');
  expect(state.calls.every((call) => call.startsWith('GET'))).toBe(true);
});

test('ignored label events and malformed run names cannot remove another request label', async () => {
  for (const display_title of [
    'Ignored eval request',
    'Evals PR #42 at main',
    `Evals PR #42 at ${sha}\nmalicious`,
  ]) {
    const { state, fetcher } = fixture();
    state.run.display_title = display_title;
    await finishEvalsRequest(env, fetcher);
    expect(state.calls).toHaveLength(1);
  }
});
