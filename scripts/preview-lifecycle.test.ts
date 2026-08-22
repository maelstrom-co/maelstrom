import { describe, expect, test } from 'bun:test';
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
  teardownPreview,
} from './preview-lifecycle.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const REPOSITORY = 'maelstrom-co/maelstrom';
const BOT_LOGIN = 'github-actions[bot]';
const COMMENT_MARKER_FOR_TEST = '<!-- pr-preview-demo -->';

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
}

const markerBody = (approvedSha?: string, deployedSha?: string) => {
  const state = JSON.stringify({ approvedSha, deployedSha });
  return `<!-- pr-preview-demo -->\n<!-- pr-preview-state ${state} -->`;
};

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
    expect(body).toContain(`**PR previews deployed** for commit ${SHA_A}`);
    expect(body).toContain(
      '| Website | https://maelstrom-www-alchemy-pr-42.preview.workers.dev/ |',
    );
  });
});

describe('approvePreview', () => {
  test('records the exact live same-repository SHA and preserves deployed content', async () => {
    const oldBody = `${markerBody(SHA_A, SHA_A)}\n\nold deployed body`;
    const state = baseState({
      sha: SHA_B,
      comments: [
        { id: 1, body: oldBody, user: { login: BOT_LOGIN, type: 'Bot' } },
      ],
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    await approvePreview(
      { repository: REPOSITORY, prNumber: '42', eventHeadSha: SHA_B },
      dependencies(githubFetch(state, calls)),
    );

    expect(parsePreviewComment(state.comments[0]!.body)).toEqual({
      approvedSha: SHA_B,
      deployedSha: SHA_A,
    });
    expect(state.comments[0]!.body).toContain('old deployed body');
  });

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
      { repository: REPOSITORY, prNumber: '42', eventHeadSha: SHA_A },
      dependencies(githubFetch(state, [])),
    );

    expect(state.comments[0]!.body).toContain('**PR preview approved**');
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
          { repository: REPOSITORY, prNumber: '42', eventHeadSha: SHA_A },
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
      { repository: REPOSITORY, prNumber: '42', eventHeadSha: SHA_A },
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
        { repository: REPOSITORY, prNumber: '42', eventHeadSha: SHA_A },
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
    expect(
      calls.filter(
        ({ url, init }) => url.endsWith('/pulls/42') && !init?.method,
      ),
    ).toHaveLength(3);
    expect(sleeps).toEqual([2_000, 4_000]);
    expect(state.labeled).toBeFalse();
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
    expect(state.comments[0]!.body).toContain('PR previews deployed');
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
    expect(state.comments[0]!.body).toContain('teardown incomplete');
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
