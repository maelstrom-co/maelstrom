import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  approvePreview,
  decideTeardownScope,
  deployPreviewApp,
  finishPreviewDeployment,
  invalidatePreviewApproval,
  type LifecycleDependencies,
  type PreviewApp,
  parsePreviewComment,
  renderDeployedComment,
  reportPreviewCiFailure,
  reportPreviewDeployOutcome,
  teardownPreview,
} from './preview-lifecycle.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const REPOSITORY = 'maelstrom-co/maelstrom';
const BOT_LOGIN = 'github-actions[bot]';
const COMMENT_MARKER_FOR_TEST = '<!-- pr-preview-demo -->';
const APPROVAL_NOTICE_MARKER_FOR_TEST = '<!-- preview-approval-request -->';

interface GithubState {
  state: 'open' | 'closed';
  sha: string;
  branch: string;
  repository: string;
  labeled: boolean;
  comments: Array<{
    id: number;
    body: string;
    user: { login: string; type: string };
  }>;
  ciRun?: unknown;
  deployRuns?: unknown[];
}

const markerBody = (approvedSha?: string, deployedSha?: string) => {
  const state = JSON.stringify({ approvedSha, deployedSha });
  return `<!-- pr-preview-demo -->\n<!-- pr-preview-state ${state} -->`;
};

const commitLink = (sha: string) =>
  `[${sha.slice(0, 7)}](https://github.com/${REPOSITORY}/commit/${sha})`;

const PREVIEW_TABLE = [
  '| App | Preview |',
  '| --- | --- |',
  '| Website | https://maelstrom-www-alchemy-pr-42.preview.workers.dev/ |',
  '| Documentation | https://maelstrom-docs-alchemy-pr-42.preview.workers.dev/ |',
  '| Demo | https://maelstrom-playground-alchemy-pr-42.preview.workers.dev/ |',
].join('\n');

const PREVIEW_FOOTER =
  'Remove the `deploy-preview` label or close this PR to tear the preview down.';

const previouslyPostedDeployedBody = (
  approvedSha: string,
  deployedSha: string,
) =>
  `${markerBody(approvedSha, deployedSha)}\n**PR previews deployed** for commit ${deployedSha}\n\n${PREVIEW_TABLE}\n\n${PREVIEW_FOOTER}`;

const headlineLines = (body: string) => {
  const end = body.indexOf('\n\n');
  return body
    .slice(0, end < 0 ? undefined : end)
    .split('\n')
    .slice(2);
};

const botComment = (id: number, body: string) => ({
  id,
  body,
  user: { login: BOT_LOGIN, type: 'Bot' },
});

const commentWrites = (calls: Array<{ url: string; init?: RequestInit }>) =>
  calls.filter(
    ({ init }) => init?.method === 'PATCH' || init?.method === 'POST',
  );

const githubFetch = (
  state: GithubState,
  calls: Array<{ url: string; init?: RequestInit }>,
  onDelete?: (attempt: number) => Response | undefined,
) => {
  let deleteAttempt = 0;
  return Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init });
      const method = init?.method ?? 'GET';
      if (url.endsWith('/pulls/42') && method === 'GET') {
        return Response.json({
          state: state.state,
          head: {
            sha: state.sha,
            ref: state.branch,
            repo: { full_name: state.repository },
          },
          labels: state.labeled ? [{ name: 'deploy-preview' }] : [],
        });
      }
      if (url.includes('/issues/42/comments') && method === 'GET') {
        return Response.json(state.comments);
      }
      if (url.includes('/actions/runs/') && method === 'GET') {
        return Response.json(state.ciRun);
      }
      if (
        url.includes('/actions/workflows/deploy-preview.yml/runs?') &&
        method === 'GET'
      ) {
        const runs = state.deployRuns ?? [];
        return Response.json({ total_count: runs.length, workflow_runs: runs });
      }
      if (url.endsWith('/issues/42/comments') && method === 'POST') {
        const body = JSON.parse(String(init?.body)).body;
        state.comments.push({
          id: 99,
          body,
          user: { login: BOT_LOGIN, type: 'Bot' },
        });
        return Response.json(state.comments.at(-1), { status: 201 });
      }
      if (url.endsWith('/issues/comments/1') && method === 'PATCH') {
        state.comments[0]!.body = JSON.parse(String(init?.body)).body;
        return Response.json(state.comments[0]);
      }
      if (
        url.endsWith('/issues/42/labels/deploy-preview') &&
        method === 'DELETE'
      ) {
        deleteAttempt += 1;
        const response = onDelete?.(deleteAttempt);
        if (response) return response;
        state.labeled = false;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected GitHub request: ${method} ${url}`);
    },
    globalThis.fetch,
  );
};

const baseState = (overrides: Partial<GithubState> = {}): GithubState => ({
  state: 'open',
  sha: SHA_A,
  branch: 'preview-work',
  repository: REPOSITORY,
  labeled: true,
  comments: [],
  ...overrides,
});

const dependencies = (
  fetch: typeof globalThis.fetch,
  overrides: Partial<LifecycleDependencies> = {},
): LifecycleDependencies => ({
  fetch,
  githubToken: 'test-token',
  runProcess: async () => ({ stdout: '' }),
  deleteWorkers: async () => true,
  discoverWorkers: async () => [],
  sleep: async () => {},
  writeOutput: () => {},
  ...overrides,
});

describe('preview comment persistence', () => {
  test('parses separate approval and deployment markers', () => {
    expect(parsePreviewComment(markerBody(SHA_B, SHA_A))).toEqual({
      approvedSha: SHA_B,
      deployedSha: SHA_A,
    });
  });

  test('uses the existing deployed sentence as a persisted legacy fallback', () => {
    expect(
      parsePreviewComment(
        `<!-- pr-preview-demo -->\n**PR previews deployed** for commit ${SHA_A}`,
      ),
    ).toEqual({ approvedSha: undefined, deployedSha: SHA_A });
  });

  test('rejects malformed, duplicate, and extended hidden state', () => {
    expect(() =>
      parsePreviewComment(`${markerBody(SHA_A)}\n${markerBody(SHA_B)}`),
    ).toThrow('multiple state markers');
    expect(() =>
      parsePreviewComment(
        `${COMMENT_MARKER_FOR_TEST}\n<!-- pr-preview-state nope -->`,
      ),
    ).toThrow('invalid state marker');
    expect(() =>
      parsePreviewComment(
        `${COMMENT_MARKER_FOR_TEST}\n<!-- pr-preview-state {"approvedSha":"${SHA_A}","extra":true} -->`,
      ),
    ).toThrow('unknown field');
  });

  test('renders validated URLs and both SHAs after successful deployment', () => {
    const body = renderDeployedComment({
      repository: REPOSITORY,
      approvedSha: SHA_A,
      deployedSha: SHA_A,
      demoUrl:
        'https://maelstrom-playground-alchemy-pr-42.preview.workers.dev/',
      docsUrl: 'https://maelstrom-docs-alchemy-pr-42.preview.workers.dev/',
      wwwUrl: 'https://maelstrom-www-alchemy-pr-42.preview.workers.dev/',
    });
    expect(parsePreviewComment(body)).toEqual({
      approvedSha: SHA_A,
      deployedSha: SHA_A,
    });
    expect(headlineLines(body)).toEqual([
      `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
    ]);
    expect(body).not.toContain('PR previews deployed');
    expect(body).toContain(PREVIEW_TABLE);
  });

  test('reads its own new comments from hidden state instead of the visible headline', () => {
    const body = renderDeployedComment({
      repository: REPOSITORY,
      approvedSha: SHA_B,
      deployedSha: SHA_A,
      demoUrl:
        'https://maelstrom-playground-alchemy-pr-42.preview.workers.dev/',
      docsUrl: 'https://maelstrom-docs-alchemy-pr-42.preview.workers.dev/',
      wwwUrl: 'https://maelstrom-www-alchemy-pr-42.preview.workers.dev/',
    });
    expect(parsePreviewComment(body)).toEqual({
      approvedSha: SHA_B,
      deployedSha: SHA_A,
    });
    expect(
      parsePreviewComment(previouslyPostedDeployedBody(SHA_B, SHA_A)),
    ).toEqual({ approvedSha: SHA_B, deployedSha: SHA_A });
  });
});

describe('approvePreview', () => {
  test('a new approval keeps the deployed URLs and says the newer commit is deploying without claiming what the preview shows', async () => {
    const state = baseState({
      sha: SHA_B,
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_A, SHA_A))],
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    await approvePreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        eventHeadSha: SHA_B,
        progress: 'deploying',
      },
      dependencies(githubFetch(state, calls)),
    );

    const body = state.comments[0]!.body;
    expect(parsePreviewComment(body)).toEqual({
      approvedSha: SHA_B,
      deployedSha: SHA_A,
    });
    expect(headlineLines(body)).toEqual([
      `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
      `🚀 **Deploying preview** for ${commitLink(SHA_B)}`,
    ]);
    expect(body).not.toContain('PR previews deployed');
    expect(body).toContain(`\n\n${PREVIEW_TABLE}\n\n${PREVIEW_FOOTER}`);
  });

  test('a maintainer push says the newer commit is waiting for CI', async () => {
    const state = baseState({
      sha: SHA_B,
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_A, SHA_A))],
    });

    await approvePreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        eventHeadSha: SHA_B,
        progress: 'awaiting-ci',
      },
      dependencies(githubFetch(state, [])),
    );

    expect(headlineLines(state.comments[0]!.body)).toEqual([
      `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
      `⏳ Newer commit ${commitLink(SHA_B)} is waiting for CI. The preview still shows ${commitLink(SHA_A)}.`,
    ]);
    expect(state.comments[0]!.body).toContain(PREVIEW_TABLE);
  });

  test('reapproving the deployed commit shows only the deployed headline', async () => {
    const state = baseState({
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_A, SHA_A))],
    });

    await approvePreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        eventHeadSha: SHA_A,
        progress: 'deploying',
      },
      dependencies(githubFetch(state, [])),
    );

    expect(headlineLines(state.comments[0]!.body)).toEqual([
      `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
    ]);
  });

  test('a legacy comment without hidden state gains it and keeps its URLs', async () => {
    const state = baseState({
      sha: SHA_B,
      comments: [
        botComment(
          1,
          `${COMMENT_MARKER_FOR_TEST}\n**PR previews deployed** for commit ${SHA_A}\n\n${PREVIEW_TABLE}\n\n${PREVIEW_FOOTER}`,
        ),
      ],
    });

    await approvePreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        eventHeadSha: SHA_B,
        progress: 'awaiting-ci',
      },
      dependencies(githubFetch(state, [])),
    );

    const body = state.comments[0]!.body;
    expect(parsePreviewComment(body)).toEqual({
      approvedSha: SHA_B,
      deployedSha: SHA_A,
    });
    expect(body.match(/<!-- pr-preview-state /g)).toHaveLength(1);
    expect(headlineLines(body)).toEqual([
      `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
      `⏳ Newer commit ${commitLink(SHA_B)} is waiting for CI. The preview still shows ${commitLink(SHA_A)}.`,
    ]);
    expect(body).toContain(PREVIEW_TABLE);
  });

  test.each([
    [
      'awaiting-ci',
      `🟡 **Preview approved** for ${commitLink(SHA_A)}, waiting for CI`,
    ],
    ['deploying', `🚀 **Deploying preview** for ${commitLink(SHA_A)}`],
  ] as const)(
    'a first %s approval posts a single headline',
    async (progress, headline) => {
      const state = baseState();

      await approvePreview(
        {
          repository: REPOSITORY,
          prNumber: '42',
          eventHeadSha: SHA_A,
          progress,
        },
        dependencies(githubFetch(state, [])),
      );

      expect(state.comments).toHaveLength(1);
      expect(state.comments[0]!.body).toBe(`${markerBody(SHA_A)}\n${headline}`);
    },
  );

  test('replaces stale teardown wording with a pending approval when nothing is deployed', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: `${markerBody()}\n\n**PR previews torn down.**`,
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });

    await approvePreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        eventHeadSha: SHA_A,
        progress: 'deploying',
      },
      dependencies(githubFetch(state, [])),
    );

    expect(headlineLines(state.comments[0]!.body)).toEqual([
      `🚀 **Deploying preview** for ${commitLink(SHA_A)}`,
    ]);
    expect(state.comments[0]!.body).not.toContain('torn down');
    expect(parsePreviewComment(state.comments[0]!.body)).toEqual({
      approvedSha: SHA_A,
      deployedSha: undefined,
    });
  });

  test('rejects stale SHA, forks, closed PRs, missing labels, and SHA-like branches', async () => {
    const invalid = [
      baseState({ sha: SHA_B }),
      baseState({ repository: 'fork/repository' }),
      baseState({ state: 'closed' }),
      baseState({ labeled: false }),
      baseState({ branch: 'abcdef123456' }),
    ];
    for (const state of invalid) {
      await expect(
        approvePreview(
          {
            repository: REPOSITORY,
            prNumber: '42',
            eventHeadSha: SHA_A,
            progress: 'deploying',
          },
          dependencies(githubFetch(state, [])),
        ),
      ).rejects.toThrow();
    }
  });

  test('paginates bot comments and updates the latest marker comment', async () => {
    const state = baseState();
    const requests: string[] = [];
    const fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();
        requests.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/pulls/42')) {
          return Response.json({
            state: 'open',
            head: { sha: SHA_A, ref: 'work', repo: { full_name: REPOSITORY } },
            labels: [{ name: 'deploy-preview' }],
          });
        }
        if (url.endsWith('/comments?per_page=100')) {
          return Response.json([], {
            headers: {
              Link: `<https://api.github.com/repos/${REPOSITORY}/issues/42/comments?per_page=100&page=2>; rel="next"`,
            },
          });
        }
        if (url.endsWith('/comments?per_page=100&page=2')) {
          return Response.json([
            {
              id: 2,
              body: markerBody(SHA_A, SHA_B),
              user: { login: BOT_LOGIN, type: 'Bot' },
            },
          ]);
        }
        if (url.endsWith('/issues/comments/2') && init?.method === 'PATCH') {
          return Response.json({
            id: 2,
            body: JSON.parse(String(init.body)).body,
            user: { login: BOT_LOGIN, type: 'Bot' },
          });
        }
        throw new Error(`Unexpected request ${url}`);
      },
      globalThis.fetch,
    );

    await approvePreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        eventHeadSha: SHA_A,
        progress: 'deploying',
      },
      dependencies(fetch),
    );

    expect(requests.at(-1)).toContain('/issues/comments/2');
    expect(state.labeled).toBeTrue();
  });

  test('a delayed approval does not write after the live head and marker change', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: markerBody(SHA_A, SHA_A),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const baseFetch = githubFetch(state, calls);
    let pullReads = 0;
    const fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        if (input.toString().endsWith('/pulls/42') && !init?.method) {
          pullReads += 1;
          if (pullReads === 2) {
            state.sha = SHA_B;
            state.comments[0]!.body = markerBody(SHA_B, SHA_A);
          }
        }
        return baseFetch(input, init);
      },
      globalThis.fetch,
    );

    await expect(
      approvePreview(
        {
          repository: REPOSITORY,
          prNumber: '42',
          eventHeadSha: SHA_A,
          progress: 'deploying',
        },
        dependencies(fetch),
      ),
    ).rejects.toThrow('approval event');

    expect(
      calls.some(
        ({ init }) => init?.method === 'PATCH' || init?.method === 'POST',
      ),
    ).toBeFalse();
    expect(parsePreviewComment(state.comments[0]!.body).approvedSha).toBe(
      SHA_B,
    );
  });
});

describe('invalidatePreviewApproval', () => {
  test('a completed fresh marker makes a delayed invalidation skip', async () => {
    const state = baseState({
      sha: SHA_B,
      comments: [
        {
          id: 1,
          body: markerBody(SHA_B, SHA_A),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    const result = await invalidatePreviewApproval(
      {
        repository: REPOSITORY,
        prNumber: '42',
        beforeSha: SHA_A,
        afterSha: SHA_B,
      },
      dependencies(githubFetch(state, calls)),
    );

    expect(result).toBe('superseded');
    expect(state.labeled).toBeTrue();
    expect(calls.some(({ init }) => init?.method === 'DELETE')).toBeFalse();
  });

  test('removes only a stale approval and rechecks before every bounded retry', async () => {
    const state = baseState({
      sha: SHA_B,
      comments: [
        {
          id: 1,
          body: markerBody(SHA_A, SHA_A),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const sleeps: number[] = [];

    await invalidatePreviewApproval(
      {
        repository: REPOSITORY,
        prNumber: '42',
        beforeSha: SHA_A,
        afterSha: SHA_B,
      },
      dependencies(
        githubFetch(state, calls, (attempt) =>
          attempt < 3
            ? Response.json({ message: 'busy' }, { status: 500 })
            : undefined,
        ),
        {
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
          },
        },
      ),
    );

    expect(calls.filter(({ init }) => init?.method === 'DELETE')).toHaveLength(
      3,
    );
    let previousDelete = -1;
    for (let index = 0; index < calls.length; index += 1) {
      if (calls[index]?.init?.method !== 'DELETE') continue;
      const lookups = calls.slice(previousDelete + 1, index);
      expect(lookups.some(({ url }) => url.endsWith('/pulls/42'))).toBeTrue();
      expect(
        lookups.some(({ url }) => url.includes('/issues/42/comments')),
      ).toBeTrue();
      previousDelete = index;
    }
    expect(sleeps).toEqual([2_000, 4_000]);
    expect(state.labeled).toBeFalse();
  });
});

const failedCiRun = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  name: 'CI',
  path: '.github/workflows/ci.yml',
  event: 'pull_request',
  status: 'completed',
  conclusion: 'failure',
  head_sha: SHA_B,
  repository: { full_name: REPOSITORY },
  head_repository: { full_name: REPOSITORY },
  pull_requests: [{ number: 42 }],
  ...overrides,
});

const labelTriggeredRun = (overrides: Record<string, unknown> = {}) => ({
  id: 9,
  event: 'pull_request_target',
  head_sha: SHA_B,
  status: 'completed',
  ...overrides,
});

const previousFormatApprovalNotice = (sha: string) =>
  `${APPROVAL_NOTICE_MARKER_FOR_TEST}\nA \`preview\` environment approval is pending for commit ${sha}: [review the run](https://github.com/${REPOSITORY}/actions/runs/9).\n\nThe run asks once to deploy the preview and, when a voice benchmark is requested, again before benchmarking. This notice is removed when the run no longer waits.`;

describe('reportPreviewCiFailure', () => {
  test('says CI failed under the deployed preview without touching hidden state or URLs', async () => {
    const state = baseState({
      sha: SHA_B,
      ciRun: failedCiRun(),
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A))],
    });

    expect(
      await reportPreviewCiFailure(
        { repository: REPOSITORY, prNumber: '42', runId: '7' },
        dependencies(githubFetch(state, [])),
      ),
    ).toBeTrue();

    const body = state.comments[0]!.body;
    expect(parsePreviewComment(body)).toEqual({
      approvedSha: SHA_B,
      deployedSha: SHA_A,
    });
    expect(headlineLines(body)).toEqual([
      `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
      `❌ CI failed on ${commitLink(SHA_B)}, so no deploy is coming. The preview still shows ${commitLink(SHA_A)}.`,
    ]);
    expect(body).toContain(`\n\n${PREVIEW_TABLE}\n\n${PREVIEW_FOOTER}`);
  });

  test('says CI failed in the headline when nothing is deployed', async () => {
    const state = baseState({
      sha: SHA_B,
      ciRun: failedCiRun(),
      comments: [botComment(1, markerBody(SHA_B))],
    });

    await reportPreviewCiFailure(
      { repository: REPOSITORY, prNumber: '42', runId: '7' },
      dependencies(githubFetch(state, [])),
    );

    expect(state.comments[0]!.body).toBe(
      `${markerBody(SHA_B)}\n❌ CI failed on ${commitLink(SHA_B)}, so no deploy is coming.`,
    );
  });

  test.each([
    ['cancelled', 'cancelled'],
    ['timed_out', 'timed out'],
    ['startup_failure', 'startup failure'],
    ['stale', 'stale'],
  ])(
    'says CI did not finish when the run ended %s',
    async (conclusion, described) => {
      const state = baseState({
        sha: SHA_B,
        ciRun: failedCiRun({ conclusion }),
        comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A))],
      });

      expect(
        await reportPreviewCiFailure(
          { repository: REPOSITORY, prNumber: '42', runId: '7' },
          dependencies(githubFetch(state, [])),
        ),
      ).toBeTrue();

      const body = state.comments[0]!.body;
      expect(parsePreviewComment(body)).toEqual({
        approvedSha: SHA_B,
        deployedSha: SHA_A,
      });
      expect(headlineLines(body)).toEqual([
        `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
        `⚠️ CI did not finish on ${commitLink(SHA_B)} (${described}), so no deploy is coming. The preview still shows ${commitLink(SHA_A)}.`,
      ]);
      expect(body).toContain(`\n\n${PREVIEW_TABLE}\n\n${PREVIEW_FOOTER}`);
    },
  );

  test('says CI did not finish in the headline when nothing is deployed', async () => {
    const state = baseState({
      sha: SHA_B,
      ciRun: failedCiRun({ conclusion: 'timed_out' }),
      comments: [botComment(1, markerBody(SHA_B))],
    });

    await reportPreviewCiFailure(
      { repository: REPOSITORY, prNumber: '42', runId: '7' },
      dependencies(githubFetch(state, [])),
    );

    expect(state.comments[0]!.body).toBe(
      `${markerBody(SHA_B)}\n⚠️ CI did not finish on ${commitLink(SHA_B)} (timed out), so no deploy is coming.`,
    );
  });

  test.each<[string, Partial<GithubState>]>([
    ['a successful run', { ciRun: failedCiRun({ conclusion: 'success' }) }],
    ['a skipped run', { ciRun: failedCiRun({ conclusion: 'skipped' }) }],
    ['a neutral run', { ciRun: failedCiRun({ conclusion: 'neutral' }) }],
    [
      'a run waiting for approval',
      { ciRun: failedCiRun({ conclusion: 'action_required' }) },
    ],
    [
      'a run still in progress',
      { ciRun: failedCiRun({ status: 'in_progress', conclusion: null }) },
    ],
    [
      'a run superseded by a newer push',
      { ciRun: failedCiRun({ conclusion: 'cancelled', head_sha: SHA_A }) },
    ],
    ['another workflow', { ciRun: failedCiRun({ name: 'Lint' }) }],
    ['a push run', { ciRun: failedCiRun({ event: 'push' }) }],
    [
      'a fork run',
      { ciRun: failedCiRun({ head_repository: { full_name: 'fork/repo' } }) },
    ],
    ['a run without a PR', { ciRun: failedCiRun({ pull_requests: [] }) }],
    [
      'a run for another PR',
      { ciRun: failedCiRun({ pull_requests: [{ number: 43 }] }) },
    ],
    ['a moved head', { sha: SHA_A }],
    ['a removed label', { labeled: false }],
    ['a closed PR', { state: 'closed' as const }],
    [
      'a stale approval',
      { comments: [botComment(1, previouslyPostedDeployedBody(SHA_A, SHA_A))] },
    ],
    [
      'an already deployed head',
      { comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_B))] },
    ],
    [
      'a manual deployment still waiting for approval',
      {
        comments: [
          botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A)),
          botComment(
            2,
            `${APPROVAL_NOTICE_MARKER_FOR_TEST}\n🔐 A \`preview\` environment approval is pending for commit ${commitLink(SHA_B)}: [review the run](https://github.com/${REPOSITORY}/actions/runs/9).`,
          ),
        ],
      },
    ],
    [
      'a manual deployment waiting for approval under the previous notice format',
      {
        comments: [
          botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A)),
          botComment(2, previousFormatApprovalNotice(SHA_B)),
        ],
      },
    ],
    ...['queued', 'requested', 'waiting', 'pending', 'in_progress'].map(
      (status): [string, Partial<GithubState>] => [
        `a label-triggered run for the head that is ${status}`,
        { deployRuns: [labelTriggeredRun({ status })] },
      ],
    ),
  ])('ignores %s', async (_name, overrides) => {
    const state = baseState({
      sha: SHA_B,
      ciRun: failedCiRun(),
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A))],
      ...overrides,
    });
    const before = state.comments.map(({ body }) => body);
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    expect(
      await reportPreviewCiFailure(
        { repository: REPOSITORY, prNumber: '42', runId: '7' },
        dependencies(githubFetch(state, calls)),
      ),
    ).toBeFalse();

    expect(commentWrites(calls)).toEqual([]);
    expect(state.comments.map(({ body }) => body)).toEqual(before);
  });

  test('checks for a pending label deploy after the final snapshot and before writing', async () => {
    const state = baseState({
      sha: SHA_B,
      ciRun: failedCiRun(),
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A))],
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    await reportPreviewCiFailure(
      { repository: REPOSITORY, prNumber: '42', runId: '7' },
      dependencies(githubFetch(state, calls)),
    );

    expect(
      calls.map(
        ({ url, init }) =>
          `${init?.method ?? 'GET'} ${url.replace(`https://api.github.com/repos/${REPOSITORY}`, '')}`,
      ),
    ).toEqual([
      'GET /actions/runs/7',
      'GET /pulls/42',
      'GET /issues/42/comments?per_page=100',
      'GET /issues/42/comments?per_page=100',
      `GET /actions/workflows/deploy-preview.yml/runs?event=pull_request_target&head_sha=${SHA_B}&per_page=100`,
      'PATCH /issues/comments/1',
    ]);
  });

  test('an approval landing at any point of the report never shows CI failed while its label run is active', async () => {
    for (let landing = 0; landing <= 8; landing += 1) {
      const state = baseState({
        sha: SHA_B,
        ciRun: failedCiRun(),
        deployRuns: [labelTriggeredRun({ status: 'in_progress' })],
        comments: [botComment(1, previouslyPostedDeployedBody(SHA_A, SHA_A))],
      });
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const github = githubFetch(state, calls);
      let requests = 0;
      const interleaved = Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          if (requests === landing)
            state.comments[0]!.body = previouslyPostedDeployedBody(
              SHA_B,
              SHA_A,
            );
          requests += 1;
          return github(input, init);
        },
        globalThis.fetch,
      );

      expect(
        await reportPreviewCiFailure(
          { repository: REPOSITORY, prNumber: '42', runId: '7' },
          dependencies(interleaved),
        ),
      ).toBeFalse();
      expect(commentWrites(calls)).toEqual([]);
    }
  });

  test.each([
    ['a finished label-triggered run', labelTriggeredRun()],
    [
      'an automatic run',
      labelTriggeredRun({ event: 'workflow_run', status: 'in_progress' }),
    ],
    [
      'a label-triggered run for an earlier head',
      labelTriggeredRun({ head_sha: SHA_A, status: 'waiting' }),
    ],
  ])('still reports CI beside %s', async (_name, run) => {
    const state = baseState({
      sha: SHA_B,
      ciRun: failedCiRun(),
      deployRuns: [run],
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A))],
    });

    expect(
      await reportPreviewCiFailure(
        { repository: REPOSITORY, prNumber: '42', runId: '7' },
        dependencies(githubFetch(state, [])),
      ),
    ).toBeTrue();
    expect(state.comments[0]!.body).toContain('❌ CI failed on');
  });

  test('refuses to write when GitHub returns an invalid workflow runs envelope', async () => {
    const state = baseState({
      sha: SHA_B,
      ciRun: failedCiRun(),
      deployRuns: [{ id: 9 }],
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A))],
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    await expect(
      reportPreviewCiFailure(
        { repository: REPOSITORY, prNumber: '42', runId: '7' },
        dependencies(githubFetch(state, calls)),
      ),
    ).rejects.toThrow('workflow runs');
    expect(commentWrites(calls)).toEqual([]);
  });

  test.each([
    ['failure', previouslyPostedDeployedBody(SHA_B, SHA_A)],
    ['failure', markerBody(SHA_B)],
    ['cancelled', previouslyPostedDeployedBody(SHA_B, SHA_A)],
    ['cancelled', markerBody(SHA_B)],
  ] as const)(
    'a later CI report keeps the %s deploy line and its run link',
    async (result, previous) => {
      const state = baseState({
        sha: SHA_B,
        ciRun: failedCiRun(),
        comments: [botComment(1, previous)],
      });
      await reportPreviewDeployOutcome(
        {
          repository: REPOSITORY,
          prNumber: '42',
          approvedSha: SHA_B,
          result,
          runId: '555',
        },
        dependencies(githubFetch(state, [])),
      );
      const reported = state.comments[0]!.body;
      expect(reported).toContain(
        `](https://github.com/${REPOSITORY}/actions/runs/555)`,
      );
      const calls: Array<{ url: string; init?: RequestInit }> = [];

      expect(
        await reportPreviewCiFailure(
          { repository: REPOSITORY, prNumber: '42', runId: '7' },
          dependencies(githubFetch(state, calls)),
        ),
      ).toBeFalse();

      expect(commentWrites(calls)).toEqual([]);
      expect(state.comments[0]!.body).toBe(reported);
    },
  );

  test('a deploy line for an earlier head does not hide CI on a newer approval', async () => {
    const state = baseState({
      sha: SHA_B,
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A))],
    });
    await reportPreviewDeployOutcome(
      {
        repository: REPOSITORY,
        prNumber: '42',
        approvedSha: SHA_B,
        result: 'failure',
        runId: '555',
      },
      dependencies(githubFetch(state, [])),
    );
    state.sha = SHA_C;
    await approvePreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        eventHeadSha: SHA_C,
        progress: 'awaiting-ci',
      },
      dependencies(githubFetch(state, [])),
    );
    state.ciRun = failedCiRun({ head_sha: SHA_C });

    expect(
      await reportPreviewCiFailure(
        { repository: REPOSITORY, prNumber: '42', runId: '7' },
        dependencies(githubFetch(state, [])),
      ),
    ).toBeTrue();
    expect(headlineLines(state.comments[0]!.body)).toEqual([
      `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
      `❌ CI failed on ${commitLink(SHA_C)}, so no deploy is coming. The preview still shows ${commitLink(SHA_A)}.`,
    ]);
  });

  test('rejects malformed run and pull request identities before reading GitHub', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    for (const options of [
      { repository: REPOSITORY, prNumber: '42', runId: 'latest' },
      { repository: REPOSITORY, prNumber: '', runId: '7' },
    ]) {
      await expect(
        reportPreviewCiFailure(
          options,
          dependencies(githubFetch(baseState(), calls)),
        ),
      ).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });
});

describe('reportPreviewDeployOutcome', () => {
  const runUrl = `https://github.com/${REPOSITORY}/actions/runs/555`;

  test.each([
    [
      'failure',
      previouslyPostedDeployedBody(SHA_B, SHA_A),
      [
        `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
        `💥 **Preview deploy failed** for ${commitLink(SHA_B)} ([run](${runUrl})). Some preview apps may already run ${commitLink(SHA_B)}.`,
      ],
    ],
    [
      'failure',
      markerBody(SHA_B),
      [
        `💥 **Preview deploy failed** for ${commitLink(SHA_B)} ([run](${runUrl}))`,
      ],
    ],
    [
      'cancelled',
      previouslyPostedDeployedBody(SHA_B, SHA_A),
      [
        `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
        `⏸️ Deploy of ${commitLink(SHA_B)} was cancelled. Some preview apps may already run ${commitLink(SHA_B)}. [Re-run the deploy](${runUrl}) to try again.`,
      ],
    ],
    [
      'cancelled',
      markerBody(SHA_B),
      [
        `⏸️ Deploy of ${commitLink(SHA_B)} was cancelled. [Re-run the deploy](${runUrl}) to try again.`,
      ],
    ],
  ] as const)(
    'a %s deploy job explains why the approved commit is not deployed',
    async (result, previous, expected) => {
      const state = baseState({
        sha: SHA_B,
        comments: [botComment(1, previous)],
      });

      expect(
        await reportPreviewDeployOutcome(
          {
            repository: REPOSITORY,
            prNumber: '42',
            approvedSha: SHA_B,
            result,
            runId: '555',
          },
          dependencies(githubFetch(state, [])),
        ),
      ).toBeTrue();

      const body = state.comments[0]!.body;
      expect(parsePreviewComment(body)).toEqual(parsePreviewComment(previous));
      expect(headlineLines(body)).toEqual([...expected]);
      expect(headlineLines(body).join('\n')).not.toContain('deploy-preview');
      if (previous.includes(PREVIEW_TABLE))
        expect(body).toContain(`\n\n${PREVIEW_TABLE}\n\n${PREVIEW_FOOTER}`);
    },
  );

  test.each<[string, Partial<GithubState>]>([
    ['a removed label', { labeled: false }],
    ['a moved head', { sha: SHA_A }],
    ['a closed PR', { state: 'closed' as const }],
    [
      'a superseded approval',
      { comments: [botComment(1, previouslyPostedDeployedBody(SHA_A, SHA_A))] },
    ],
    [
      'an approval another run already deployed',
      { comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_B))] },
    ],
    ['a missing preview comment', { comments: [] }],
  ])('ignores %s', async (_name, overrides) => {
    const state = baseState({
      sha: SHA_B,
      comments: [botComment(1, previouslyPostedDeployedBody(SHA_B, SHA_A))],
      ...overrides,
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    expect(
      await reportPreviewDeployOutcome(
        {
          repository: REPOSITORY,
          prNumber: '42',
          approvedSha: SHA_B,
          result: 'failure',
          runId: '555',
        },
        dependencies(githubFetch(state, calls)),
      ),
    ).toBeFalse();

    expect(commentWrites(calls)).toEqual([]);
  });

  test('rejects results other than failure or cancellation and malformed identities', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    for (const overrides of [
      { result: 'success' },
      { result: 'skipped' },
      { runId: '1 2' },
      { approvedSha: 'main' },
    ]) {
      await expect(
        reportPreviewDeployOutcome(
          {
            repository: REPOSITORY,
            prNumber: '42',
            approvedSha: SHA_B,
            result: 'failure',
            runId: '555',
            ...overrides,
          },
          dependencies(githubFetch(baseState(), calls)),
        ),
      ).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });
});

describe('expected account boundary', () => {
  const baseOptions = {
    repository: REPOSITORY,
    prNumber: '42',
    bunExecutable: '/trusted/bun',
    accountId: 'preview-account',
    apiToken: 'secret',
    expectedAccountId: 'preview-account',
  };

  test('forwards the expected account into the Alchemy child environment', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: markerBody(SHA_A),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const processes: Parameters<LifecycleDependencies['runProcess']>[0][] = [];
    await deployPreviewApp(
      {
        ...baseOptions,
        app: 'demo',
        approvedSha: SHA_A,
        sourceRoot: '/workspace/source',
        workersDevSuffix: 'preview.workers.dev',
      },
      dependencies(githubFetch(state, []), {
        runProcess: async (options) => {
          processes.push(options);
          if (options.argv.includes('rev-parse')) {
            return { stdout: `${SHA_A}\n` };
          }
          if (options.argv.includes('get')) {
            return {
              stdout: JSON.stringify({
                attr: {
                  url: 'https://maelstrom-playground-alchemy-pr-42.preview.workers.dev/',
                },
              }),
            };
          }
          return { stdout: '' };
        },
      }),
    );
    expect(processes[3]!.env).toMatchObject({
      CLOUDFLARE_ACCOUNT_ID: 'preview-account',
      EXPECTED_CLOUDFLARE_ACCOUNT_ID: 'preview-account',
    });
  });

  test('rejects a deploy whose active account differs from the expectation before mutating', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: markerBody(SHA_A),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const processes: Parameters<LifecycleDependencies['runProcess']>[0][] = [];
    await expect(
      deployPreviewApp(
        {
          ...baseOptions,
          accountId: 'wrong-account',
          app: 'demo',
          approvedSha: SHA_A,
          sourceRoot: '/workspace/source',
          workersDevSuffix: 'preview.workers.dev',
        },
        dependencies(githubFetch(state, []), {
          runProcess: async (options) => {
            processes.push(options);
            return { stdout: `${SHA_A}\n` };
          },
        }),
      ),
    ).rejects.toThrow('does not match');
    expect(processes).toEqual([]);
  });

  test('rejects a teardown whose active account differs from the expectation before deleting', async () => {
    const state = baseState({ state: 'closed' });
    let deleteCalls = 0;
    await expect(
      teardownPreview(
        {
          ...baseOptions,
          trigger: 'manual',
          root: '/trusted',
          accountId: 'wrong-account',
        },
        dependencies(githubFetch(state, []), {
          deleteWorkers: async () => {
            deleteCalls += 1;
            return true;
          },
        }),
      ),
    ).rejects.toThrow('does not match');
    expect(deleteCalls).toBe(0);
  });
});

describe('deployPreviewApp', () => {
  for (const app of ['demo', 'www', 'docs'] as const) {
    test(`${app} validates live intent and invokes exact app metadata`, async () => {
      const state = baseState({
        comments: [
          {
            id: 1,
            body: markerBody(SHA_A),
            user: { login: BOT_LOGIN, type: 'Bot' },
          },
        ],
      });
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const processes: Parameters<LifecycleDependencies['runProcess']>[0][] =
        [];
      const suffix = 'preview.workers.dev';
      const metadata: Record<
        PreviewApp,
        { directory: string; stack: string; worker: string }
      > = {
        demo: {
          directory: 'demo',
          stack: 'MaelstromDemoPreview',
          worker: 'maelstrom-playground-alchemy-pr-42',
        },
        docs: {
          directory: 'docs',
          stack: 'MaelstromDocsPreview',
          worker: 'maelstrom-docs-alchemy-pr-42',
        },
        www: {
          directory: 'www',
          stack: 'MaelstromWwwPreview',
          worker: 'maelstrom-www-alchemy-pr-42',
        },
      };
      const expected = metadata[app];
      const output: string[] = [];

      const url = await deployPreviewApp(
        {
          app,
          repository: REPOSITORY,
          prNumber: '42',
          approvedSha: SHA_A,
          bunExecutable: '/trusted/bun',
          sourceRoot: '/workspace/source',
          accountId: 'account',
          expectedAccountId: 'account',
          apiToken: 'secret',
          workersDevSuffix: suffix,
        },
        dependencies(githubFetch(state, calls), {
          runProcess: async (options) => {
            processes.push(options);
            if (options.argv.includes('rev-parse')) {
              return { stdout: `${SHA_A}\n` };
            }
            if (options.argv.includes('get')) {
              return {
                stdout: JSON.stringify({
                  attr: { url: `https://${expected.worker}.${suffix}/` },
                }),
              };
            }
            return { stdout: '' };
          },
          writeOutput: (name, value) => output.push(`${name}=${value}`),
        }),
      );

      expect(url).toBe(`https://${expected.worker}.${suffix}/`);
      expect(processes[3]).toMatchObject({
        argv: [
          '/trusted/bun',
          'alchemy',
          'deploy',
          'alchemy.preview.run.ts',
          '--stage',
          'pr-42',
          '--profile',
          'preview-ci',
          '--yes',
        ],
        cwd: `/workspace/source/apps/${expected.directory}`,
        timeoutMs: 300_000,
      });
      expect(processes[4]!.argv).toContain(expected.stack);
      expect(processes[3]!.env).toMatchObject({
        ALCHEMY_PROFILE: 'preview-ci',
        CLOUDFLARE_ACCOUNT_ID: 'account',
        CLOUDFLARE_API_TOKEN: 'secret',
        PREVIEW_STAGE: 'pr-42',
      });
      expect(processes[3]!.env).not.toHaveProperty('GH_TOKEN');
      expect(processes.slice(0, 3).map(({ argv }) => argv)).toEqual([
        ['/usr/bin/git', 'rev-parse', 'HEAD'],
        ['/usr/bin/git', 'diff', '--quiet', 'HEAD', '--'],
        ['/usr/bin/git', 'diff', '--cached', '--quiet', 'HEAD', '--'],
      ]);
      expect(output).toEqual([
        `deployment-url=https://${expected.worker}.${suffix}/`,
      ]);
    });
  }

  test('rejects a source checkout that is not the approved SHA before mutation', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: markerBody(SHA_A),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const processes: Parameters<LifecycleDependencies['runProcess']>[0][] = [];
    await expect(
      deployPreviewApp(
        {
          app: 'demo',
          repository: REPOSITORY,
          prNumber: '42',
          approvedSha: SHA_A,
          bunExecutable: '/trusted/bun',
          sourceRoot: '/source',
          accountId: 'account',
          expectedAccountId: 'account',
          apiToken: 'secret',
          workersDevSuffix: 'preview.workers.dev',
        },
        dependencies(githubFetch(state, []), {
          runProcess: async (options) => {
            processes.push(options);
            return { stdout: `${SHA_B}\n` };
          },
        }),
      ),
    ).rejects.toThrow('source HEAD');
    expect(processes).toHaveLength(1);
  });

  for (const [kind, changedCommand] of [
    ['tracked', ['diff', '--quiet']],
    ['staged', ['diff', '--cached']],
  ] as const) {
    test(`${kind} approved source changes block mutation before GitHub or Cloudflare`, async () => {
      const state = baseState({
        comments: [
          {
            id: 1,
            body: markerBody(SHA_A),
            user: { login: BOT_LOGIN, type: 'Bot' },
          },
        ],
      });
      const githubCalls: Array<{ url: string; init?: RequestInit }> = [];
      const processes: Parameters<LifecycleDependencies['runProcess']>[0][] =
        [];

      await expect(
        deployPreviewApp(
          {
            app: 'demo',
            repository: REPOSITORY,
            prNumber: '42',
            approvedSha: SHA_A,
            bunExecutable: '/trusted/bun',
            sourceRoot: '/source',
            accountId: 'account',
            expectedAccountId: 'account',
            apiToken: 'secret',
            workersDevSuffix: 'preview.workers.dev',
          },
          dependencies(githubFetch(state, githubCalls), {
            runProcess: async (options) => {
              processes.push(options);
              if (options.argv.includes('rev-parse')) {
                return { stdout: `${SHA_A}\n` };
              }
              if (changedCommand.every((part) => options.argv.includes(part))) {
                throw new Error(`${kind} source changed`);
              }
              return { stdout: '' };
            },
          }),
        ),
      ).rejects.toThrow('source');

      expect(githubCalls).toEqual([]);
      expect(
        processes.every(({ argv }) => argv[0] === '/usr/bin/git'),
      ).toBeTrue();
    });
  }

  test('rejects relative, whitespace, and control-ambiguous Bun executables', async () => {
    for (const bunExecutable of ['bun', '/untrusted path/bun', '/bad\nbun']) {
      const processes: Parameters<LifecycleDependencies['runProcess']>[0][] =
        [];
      await expect(
        deployPreviewApp(
          {
            app: 'demo',
            repository: REPOSITORY,
            prNumber: '42',
            approvedSha: SHA_A,
            bunExecutable,
            sourceRoot: '/source',
            accountId: 'account',
            expectedAccountId: 'account',
            apiToken: 'secret',
            workersDevSuffix: 'preview.workers.dev',
          },
          dependencies(githubFetch(baseState(), []), {
            runProcess: async (options) => {
              processes.push(options);
              return { stdout: '' };
            },
          }),
        ),
      ).rejects.toThrow('Bun executable');
      expect(processes).toEqual([]);
    }
  });

  test('deploys www and docs before legacy cleanup and publication', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: markerBody(SHA_A, SHA_B),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let authorizationChecks = 0;
    const processes: Parameters<LifecycleDependencies['runProcess']>[0][] = [];

    await finishPreviewDeployment(
      {
        repository: REPOSITORY,
        prNumber: '42',
        approvedSha: SHA_A,
        bunExecutable: '/trusted/bun',
        sourceRoot: '/source',
        accountId: 'account',
        expectedAccountId: 'account',
        apiToken: 'secret',
        workersDevSuffix: 'preview.workers.dev',
        demoUrl:
          'https://maelstrom-playground-alchemy-pr-42.preview.workers.dev/',
      },
      dependencies(githubFetch(state, calls), {
        runProcess: async (options) => {
          processes.push(options);
          if (options.argv.includes('rev-parse')) {
            return { stdout: `${SHA_A}\n` };
          }
          if (options.argv.includes('get')) {
            const app = options.cwd.endsWith('/www') ? 'www' : 'docs';
            return {
              stdout: JSON.stringify({
                attr: {
                  url: `https://maelstrom-${app}-alchemy-pr-42.preview.workers.dev/`,
                },
              }),
            };
          }
          return { stdout: '' };
        },
        deleteWorkers: async (options, authorize) => {
          expect(options).toMatchObject({ attempts: 1, workerScope: 'legacy' });
          for (const worker of [
            'maelstrom-www-pr-42',
            'maelstrom-docs-pr-42',
            'maelstrom-playground-pr-42',
          ]) {
            expect(await authorize(worker)).toBeTrue();
            authorizationChecks += 1;
          }
          return true;
        },
      }),
    );

    expect(authorizationChecks).toBe(3);
    expect(
      processes
        .filter(({ argv }) => argv.includes('deploy'))
        .map(({ cwd }) => cwd),
    ).toEqual(['/source/apps/www', '/source/apps/docs']);
    expect(parsePreviewComment(state.comments[0]!.body)).toEqual({
      approvedSha: SHA_A,
      deployedSha: SHA_A,
    });
    expect(headlineLines(state.comments[0]!.body)).toEqual([
      `✅ **Preview deployed** for ${commitLink(SHA_A)}`,
    ]);
  });

  test('finish rejects dirty approved source before GitHub or Worker cleanup', async () => {
    const githubCalls: Array<{ url: string; init?: RequestInit }> = [];
    let providerCalled = false;
    await expect(
      finishPreviewDeployment(
        {
          repository: REPOSITORY,
          prNumber: '42',
          approvedSha: SHA_A,
          bunExecutable: '/trusted/bun',
          sourceRoot: '/source',
          accountId: 'account',
          expectedAccountId: 'account',
          apiToken: 'secret',
          workersDevSuffix: 'preview.workers.dev',
          demoUrl:
            'https://maelstrom-playground-alchemy-pr-42.preview.workers.dev/',
        },
        dependencies(githubFetch(baseState(), githubCalls), {
          runProcess: async (options) => {
            if (options.argv.includes('rev-parse')) {
              return { stdout: `${SHA_A}\n` };
            }
            throw new Error('dirty source');
          },
          deleteWorkers: async () => {
            providerCalled = true;
            return true;
          },
        }),
      ),
    ).rejects.toThrow('source');
    expect(githubCalls).toEqual([]);
    expect(providerCalled).toBeFalse();
  });
});

describe('teardown policy and execution', () => {
  for (const [scope, mismatch] of [
    ['all', 'version'],
    ['legacy', 'version'],
    ['all', 'store'],
  ] as const) {
    test(`a ${mismatch} mismatch blocks Alchemy but preserves authorized ${scope} Worker cleanup`, async () => {
      const root = await mkdtemp('/tmp/preview-version-mismatch-');
      const alchemy = join(root, 'infra/platform/node_modules/alchemy');
      const previous = process.env.ALCHEMY_REQUIRED_VERSION;
      const previousStore = process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER;
      const processes: string[] = [];
      const scopes: string[] = [];
      const state = baseState({
        labeled: scope === 'legacy',
        comments: [
          {
            id: 1,
            body: markerBody(SHA_A, SHA_A),
            user: { login: BOT_LOGIN, type: 'Bot' },
          },
        ],
      });
      try {
        await mkdir(alchemy, { recursive: true });
        await writeFile(
          join(alchemy, 'package.json'),
          JSON.stringify({ version: '2.0.0-beta.83' }),
        );
        if (mismatch === 'version')
          process.env.ALCHEMY_REQUIRED_VERSION = '2.0.0-beta.85';
        else {
          delete process.env.ALCHEMY_REQUIRED_VERSION;
          process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER =
            'alchemy-state-store-maelstrom-oss-preview';
          await writeFile(join(root, 'package.json'), JSON.stringify({}));
        }
        const result = await teardownPreview(
          {
            repository: REPOSITORY,
            prNumber: '42',
            trigger: scope === 'all' ? 'unlabeled' : 'schedule',
            bunExecutable: '/trusted/bun',
            accountId: 'account',
            expectedAccountId: 'account',
            apiToken: 'secret',
            root,
          },
          dependencies(githubFetch(state, []), {
            runProcess: async ({ cwd }) => {
              processes.push(cwd);
              return { stdout: '' };
            },
            deleteWorkers: async (options, authorize) => {
              scopes.push(options.workerScope ?? 'all');
              expect(await authorize('maelstrom-www-pr-42')).toBeTrue();
              expect(await authorize('maelstrom-www-alchemy-pr-42')).toBe(
                scope === 'all',
              );
              return true;
            },
          }),
        );
        expect(processes).toEqual([]);
        expect(scopes).toEqual([scope]);
        expect(result).toEqual({ scope, complete: scope === 'legacy' });
        if (scope === 'all')
          expect(state.comments[0]!.body).toContain('teardown incomplete');
      } finally {
        if (previous === undefined) delete process.env.ALCHEMY_REQUIRED_VERSION;
        else process.env.ALCHEMY_REQUIRED_VERSION = previous;
        if (previousStore === undefined)
          delete process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER;
        else process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER = previousStore;
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  test('decision table distinguishes active schedule cleanup from destructive teardown', () => {
    const current = {
      state: 'open' as const,
      sameRepository: true,
      labeled: true,
      headSha: SHA_A,
      approvedSha: SHA_A,
    };
    expect(decideTeardownScope('schedule', current)).toBe('legacy');
    expect(decideTeardownScope('manual', current)).toBe('skip');
    expect(decideTeardownScope('closed', current)).toBe('skip');
    expect(decideTeardownScope('unlabeled', current)).toBe('skip');
    expect(
      decideTeardownScope('schedule', { ...current, approvedSha: SHA_B }),
    ).toBe('all');
    expect(decideTeardownScope('manual', { ...current, labeled: false })).toBe(
      'all',
    );
    expect(
      decideTeardownScope('schedule', { ...current, state: 'closed' }),
    ).toBe('all');
  });

  test('continues independent cleanup after failure and never broadens narrowed authority', async () => {
    const state = baseState({
      labeled: false,
      comments: [
        {
          id: 1,
          body: markerBody(SHA_A, SHA_A),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const processApps: string[] = [];
    const workerScopes: string[] = [];
    const result = await teardownPreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        trigger: 'unlabeled',
        bunExecutable: '/trusted/bun',
        accountId: 'account',
        expectedAccountId: 'account',
        apiToken: 'secret',
        root: '/trusted',
      },
      dependencies(githubFetch(state, []), {
        runProcess: async (options) => {
          expect(options.argv[0]).toBe('/trusted/bun');
          processApps.push(options.cwd);
          if (options.cwd.endsWith('/docs')) throw new Error('docs failed');
          return { stdout: '' };
        },
        deleteWorkers: async (options, authorize) => {
          workerScopes.push(options.workerScope ?? 'all');
          expect(await authorize('maelstrom-www-alchemy-pr-42')).toBeTrue();
          return true;
        },
      }),
    );

    expect(processApps).toEqual([
      '/trusted/apps/docs',
      '/trusted/apps/www',
      '/trusted/apps/demo',
    ]);
    expect(workerScopes).toEqual(['all']);
    expect(result).toEqual({ scope: 'all', complete: false });
    expect(headlineLines(state.comments[0]!.body)[0]).toStartWith(
      '⚠️ **Preview teardown incomplete.**',
    );
  });

  test('scheduled active cleanup uses the exact legacy scope and is idempotent', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: markerBody(SHA_A, SHA_A),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const scopes: string[] = [];
    const githubCalls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await teardownPreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        trigger: 'schedule',
        bunExecutable: '/trusted/bun',
        accountId: 'account',
        expectedAccountId: 'account',
        apiToken: 'secret',
        root: '/trusted',
      },
      dependencies(githubFetch(state, githubCalls), {
        deleteWorkers: async (options) => {
          scopes.push(options.workerScope ?? 'all');
          return true;
        },
      }),
    );
    expect(result).toEqual({ scope: 'legacy', complete: true });
    expect(scopes).toEqual(['legacy']);
    expect(
      githubCalls.some(
        ({ url, init }) =>
          url.endsWith('/labels/deploy-preview') && init?.method === 'DELETE',
      ),
    ).toBeFalse();
  });

  test('scheduled stale approval removes its label before full provider cleanup', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: markerBody(SHA_B, SHA_B),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const events: string[] = [];
    const githubCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = githubFetch(state, githubCalls, () => {
      events.push('remove-label');
      state.labeled = false;
      return Response.json({ message: 'not found' }, { status: 404 });
    });
    const deps = dependencies(fetch, {
      runProcess: async () => {
        events.push('provider');
        return { stdout: '' };
      },
      deleteWorkers: async (options) => {
        events.push(`workers-${options.workerScope}`);
        return true;
      },
    });

    const first = await teardownPreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        trigger: 'schedule',
        bunExecutable: '/trusted/bun',
        accountId: 'account',
        expectedAccountId: 'account',
        apiToken: 'secret',
        root: '/trusted',
      },
      deps,
    );
    const second = await teardownPreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        trigger: 'unlabeled',
        bunExecutable: '/trusted/bun',
        accountId: 'account',
        expectedAccountId: 'account',
        apiToken: 'secret',
        root: '/trusted',
      },
      deps,
    );

    expect(first).toEqual({ scope: 'all', complete: true });
    expect(second).toEqual({ scope: 'all', complete: true });
    expect(parsePreviewComment(state.comments[0]!.body)).toEqual({
      approvedSha: undefined,
      deployedSha: undefined,
    });
    expect(headlineLines(state.comments[0]!.body)[0]).toStartWith(
      '🧹 **Preview removed.**',
    );
    expect(state.labeled).toBeFalse();
    expect(events.filter((event) => event === 'remove-label')).toHaveLength(1);
    expect(events.indexOf('remove-label')).toBeLessThan(
      events.indexOf('provider'),
    );
    expect(events.filter((event) => event === 'workers-all')).toHaveLength(2);
  });

  test('a fresh approval observed immediately before stale-label removal narrows cleanup', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: markerBody(SHA_B, SHA_B),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const githubCalls: Array<{ url: string; init?: RequestInit }> = [];
    const baseFetch = githubFetch(state, githubCalls);
    let pullReads = 0;
    const fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        if (input.toString().endsWith('/pulls/42') && !init?.method) {
          pullReads += 1;
          if (pullReads === 2) {
            state.comments[0]!.body = markerBody(SHA_A, SHA_B);
          }
        }
        return baseFetch(input, init);
      },
      globalThis.fetch,
    );
    const scopes: string[] = [];

    const result = await teardownPreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        trigger: 'schedule',
        bunExecutable: '/trusted/bun',
        accountId: 'account',
        expectedAccountId: 'account',
        apiToken: 'secret',
        root: '/trusted',
      },
      dependencies(fetch, {
        deleteWorkers: async (options) => {
          scopes.push(options.workerScope ?? 'all');
          return true;
        },
      }),
    );

    expect(result).toEqual({ scope: 'all', complete: true });
    expect(scopes).toEqual(['legacy']);
    expect(state.labeled).toBeTrue();
    expect(
      githubCalls.some(
        ({ url, init }) =>
          url.endsWith('/labels/deploy-preview') && init?.method === 'DELETE',
      ),
    ).toBeFalse();
  });

  test('failed stale-label removal does not block independent provider cleanup', async () => {
    const state = baseState({
      comments: [
        {
          id: 1,
          body: markerBody(SHA_B, SHA_B),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    let providerCalled = false;

    const result = await teardownPreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        trigger: 'manual',
        bunExecutable: '/trusted/bun',
        accountId: 'account',
        expectedAccountId: 'account',
        apiToken: 'secret',
        root: '/trusted',
      },
      dependencies(
        githubFetch(state, [], () =>
          Response.json({ message: 'provider failure' }, { status: 500 }),
        ),
        {
          runProcess: async () => {
            providerCalled = true;
            return { stdout: '' };
          },
          deleteWorkers: async () => {
            providerCalled = true;
            return true;
          },
        },
      ),
    );

    expect(result).toEqual({ scope: 'all', complete: false });
    expect(providerCalled).toBeTrue();
    expect(state.labeled).toBeTrue();
    expect(state.comments[0]!.body).toContain('teardown incomplete');
  });

  test('scheduled cleanup removes an unauthorized label with no persisted SHA', async () => {
    const state = baseState({ comments: [] });
    const events: string[] = [];
    const result = await teardownPreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        trigger: 'schedule',
        bunExecutable: '/trusted/bun',
        accountId: 'account',
        expectedAccountId: 'account',
        apiToken: 'secret',
        root: '/trusted',
      },
      dependencies(
        githubFetch(state, [], () => {
          events.push('remove-label');
          return undefined;
        }),
        {
          runProcess: async () => {
            events.push('provider');
            return { stdout: '' };
          },
        },
      ),
    );

    expect(result).toEqual({ scope: 'all', complete: true });
    expect(state.labeled).toBeFalse();
    expect(events[0]).toBe('remove-label');
  });

  test('a fresh approval can remove authority but can never broaden it again', async () => {
    const state = baseState({
      labeled: false,
      comments: [
        {
          id: 1,
          body: markerBody(SHA_B, SHA_B),
          user: { login: BOT_LOGIN, type: 'Bot' },
        },
      ],
    });
    const processes: string[] = [];
    let deleteCalled = false;

    const result = await teardownPreview(
      {
        repository: REPOSITORY,
        prNumber: '42',
        trigger: 'manual',
        bunExecutable: '/trusted/bun',
        accountId: 'account',
        expectedAccountId: 'account',
        apiToken: 'secret',
        root: '/trusted',
      },
      dependencies(githubFetch(state, []), {
        runProcess: async (options) => {
          processes.push(options.cwd);
          state.labeled = true;
          state.comments[0]!.body = markerBody(SHA_A, SHA_B);
          return { stdout: '' };
        },
        deleteWorkers: async () => {
          deleteCalled = true;
          return true;
        },
      }),
    );

    expect(result).toEqual({ scope: 'all', complete: true });
    expect(processes).toEqual(['/trusted/apps/docs']);
    expect(deleteCalled).toBeFalse();
    expect(parsePreviewComment(state.comments[0]!.body).approvedSha).toBe(
      SHA_A,
    );
  });
});
