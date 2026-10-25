import { describe, expect, test } from 'bun:test';
import {
  approveMaintainerPreview,
  deployPreviewApp,
  finishPreviewDeployment,
  invalidatePreviewApproval,
  type LifecycleDependencies,
  parsePreviewComment,
  teardownPreview,
} from './preview-lifecycle.ts';
import { selectMaintainerPreview } from './preview-trust.ts';

const REPOSITORY = 'maelstrom-co/maelstrom';
const HEAD = 'b'.repeat(40);
const PREVIOUS = 'a'.repeat(40);
const user = (login: string) => ({ login, type: 'User' });

const fixture = () => {
  const repository = { id: 1, full_name: REPOSITORY, default_branch: 'main' };
  const run = {
    id: 123,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    head_sha: HEAD,
    head_branch: 'feature',
    // The workflow-run repository envelope does not contain default_branch.
    repository: { id: 1, full_name: REPOSITORY },
    head_repository: { id: 1, full_name: REPOSITORY },
    actor: user('pusher'),
    triggering_actor: user('rerunner'),
    pull_requests: [
      {
        number: 42,
        head: { sha: HEAD, ref: 'feature', repo: { id: 1 } },
        base: { ref: 'main', repo: { id: 1 } },
      },
    ],
  };
  const pull = {
    state: 'open',
    user: user('author'),
    head: { sha: HEAD, ref: 'feature', repo: { full_name: REPOSITORY } },
    labels: [{ name: 'deploy-preview' }],
  };
  const comment = {
    id: 7,
    body: `<!-- pr-preview-demo -->\n<!-- pr-preview-state ${JSON.stringify({ approvedSha: PREVIOUS, deployedSha: PREVIOUS })} -->`,
    user: { login: 'github-actions[bot]', type: 'Bot' },
  };
  const roles = new Map(
    ['author', 'pusher', 'rerunner'].map((login) => [
      login,
      { permission: 'admin', role_name: 'admin', user: user(login) },
    ]),
  );
  const writes: Array<{ path: string; method: string }> = [];
  const outputs = new Map<string, string>();
  const mutations: string[] = [];
  let lookupStatus = 200;
  let beforeRead: (path: string) => void = () => {};
  const dependencies: LifecycleDependencies = {
    fetch: Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname.replace(
          `/repos/${REPOSITORY}`,
          '',
        );
        const method = init?.method ?? 'GET';
        beforeRead(path);
        if (method !== 'GET') writes.push({ path, method });
        if (path === '/issues/comments/7' && method === 'PATCH') {
          comment.body = JSON.parse(String(init?.body)).body;
          return Response.json(comment);
        }
        if (
          path === '/issues/42/labels/deploy-preview' &&
          method === 'DELETE'
        ) {
          pull.labels = [];
          return new Response(null, { status: 204 });
        }
        if (method !== 'GET') throw new Error(`Unexpected mutation: ${path}`);
        if (path === '') return Response.json(repository);
        if (path === '/actions/runs/123') return Response.json(run);
        if (path === '/pulls/42') return Response.json(pull);
        if (path === '/issues/42/comments') return Response.json([comment]);
        const permission = /^\/collaborators\/([^/]+)\/permission$/.exec(path);
        if (permission) {
          const value = roles.get(permission[1]!);
          return value && lookupStatus === 200
            ? Response.json(value)
            : new Response(null, {
                status: lookupStatus === 200 ? 404 : lookupStatus,
              });
        }
        throw new Error(`Unexpected GitHub lookup: ${path}`);
      },
      globalThis.fetch,
    ),
    githubToken: 'test-token',
    runProcess: async () => {
      mutations.push('process');
      return { stdout: '' };
    },
    deleteWorkers: async () => {
      mutations.push('delete');
      return true;
    },
    discoverWorkers: async () => [],
    sleep: async () => {},
    writeOutput: (name, value) => {
      outputs.set(name, value);
    },
  };
  return {
    repository,
    run,
    pull,
    comment,
    roles,
    writes,
    outputs,
    mutations,
    dependencies,
    setStatus: (status: number) => {
      lookupStatus = status;
    },
    beforeRead: (callback: typeof beforeRead) => {
      beforeRead = callback;
    },
  };
};

const select = (f: ReturnType<typeof fixture>) =>
  selectMaintainerPreview(
    { repository: REPOSITORY, runId: '123' },
    f.dependencies,
  );
const approve = (f: ReturnType<typeof fixture>) =>
  approveMaintainerPreview(
    { repository: REPOSITORY, runId: '123' },
    f.dependencies,
  );

const deploymentOptions = {
  repository: REPOSITORY,
  prNumber: '42',
  approvedSha: HEAD,
  ciRunId: '123',
  bunExecutable: '/usr/bin/bun',
  sourceRoot: '/tmp/source',
  accountId: 'preview',
  apiToken: 'fake-token',
  expectedAccountId: 'preview',
  workersDevSuffix: 'preview.workers.dev',
};

const deploymentProcess =
  (f: ReturnType<typeof fixture>): LifecycleDependencies['runProcess'] =>
  async (options) => {
    if (options.argv[0] === '/usr/bin/git')
      return { stdout: options.argv[1] === 'rev-parse' ? HEAD : '' };
    const app = options.cwd.split('/').at(-1)!;
    if (options.argv[2] === 'deploy') {
      f.mutations.push(app);
      return { stdout: '' };
    }
    if (options.argv[2] === 'state') {
      const name = app === 'demo' ? 'playground' : app;
      return {
        stdout: JSON.stringify({
          attr: {
            url: `https://maelstrom-${name}-alchemy-pr-42.preview.workers.dev/`,
          },
        }),
      };
    }
    throw new Error('Unexpected deployment process');
  };

describe('maintainer preview authority', () => {
  test.each([
    'admin',
    'maintain',
  ])('refreshes the exact head after CI for live %s users', async (role) => {
    const f = fixture();
    for (const account of f.roles.values()) {
      account.role_name = role;
      account.permission = role === 'maintain' ? 'write' : 'admin';
    }
    expect(await approve(f)).toBe(true);
    expect(f.outputs).toEqual(
      new Map([
        ['pr-number', '42'],
        ['head-sha', HEAD],
      ]),
    );
    expect(parsePreviewComment(f.comment.body)).toEqual({
      approvedSha: HEAD,
      deployedSha: PREVIOUS,
    });
    expect(f.mutations).toEqual([]);
    expect(f.writes).toEqual([{ path: '/issues/comments/7', method: 'PATCH' }]);
  });

  test.each([
    'author',
    'pusher',
    'rerunner',
  ])('does not inherit authority from a maintainer when %s is untrusted', async (login) => {
    for (const role of ['write', 'triage', 'read', 'none', 'custom']) {
      const f = fixture();
      Object.assign(f.roles.get(login)!, {
        permission: 'write',
        role_name: role,
      });
      expect(await approve(f)).toBe(false);
      expect(f.writes).toEqual([]);
      expect(f.outputs.size).toBe(0);
    }
  });

  test('a bot identity cannot become trusted through an admin-shaped permission response', async () => {
    const f = fixture();
    f.run.actor.type = 'Bot';
    expect(await approve(f)).toBe(false);
    expect(f.writes).toEqual([]);
  });

  test('revoked access fails closed and lookup errors do not grant approval', async () => {
    const f = fixture();
    f.roles.delete('author');
    expect(await approve(f)).toBe(false);
    f.setStatus(403);
    f.roles.set('author', {
      permission: 'admin',
      role_name: 'admin',
      user: user('author'),
    });
    await expect(approve(f)).rejects.toThrow('HTTP 403');
    expect(f.writes).toEqual([]);
    expect(f.outputs.size).toBe(0);
  });

  test('a mismatched collaborator identity cannot attest another account', async () => {
    const f = fixture();
    f.roles.get('author')!.user.login = 'someone-else';
    await expect(approve(f)).rejects.toThrow('invalid collaborator identity');
    expect(f.writes).toEqual([]);
  });

  test.each([
    [
      'failed CI',
      (f: ReturnType<typeof fixture>) => {
        f.run.conclusion = 'failure';
      },
    ],
    [
      'unfinished CI',
      (f) => {
        f.run.status = 'in_progress';
      },
    ],
    [
      'push CI',
      (f) => {
        f.run.event = 'push';
      },
    ],
    [
      'other workflow',
      (f) => {
        f.run.path = '.github/workflows/other.yml';
      },
    ],
    [
      'wrong run',
      (f) => {
        f.run.id = 124;
      },
    ],
    [
      'fork run',
      (f) => {
        f.run.head_repository.full_name = 'outsider/fork';
      },
    ],
    [
      'repository identity mismatch',
      (f) => {
        f.run.head_repository.id = 2;
      },
    ],
    [
      'foreign base',
      (f) => {
        f.run.pull_requests[0]!.base.repo.id = 2;
      },
    ],
    [
      'non-default base',
      (f) => {
        f.run.pull_requests[0]!.base.ref = 'release';
      },
    ],
    [
      'ambiguous PRs',
      (f) => {
        f.run.pull_requests.push(f.run.pull_requests[0]!);
      },
    ],
    [
      'missing PR association',
      (f) => {
        f.run.pull_requests = [];
      },
    ],
    [
      'old successful commit',
      (f) => {
        f.pull.head.sha = PREVIOUS;
      },
    ],
    [
      'closed PR',
      (f) => {
        f.pull.state = 'closed';
      },
    ],
    [
      'fork PR',
      (f) => {
        f.pull.head.repo.full_name = 'outsider/fork';
      },
    ],
    [
      'opted-out PR',
      (f) => {
        f.pull.labels = [];
      },
    ],
    [
      'SHA-like branch',
      (f) => {
        f.pull.head.ref = 'deadbeef';
      },
    ],
  ] satisfies ReadonlyArray<
    readonly [string, (f: ReturnType<typeof fixture>) => void]
  >)('rejects %s before writing any approval or deployment output', async (_name, alter) => {
    const f = fixture();
    alter(f);
    expect(await approve(f)).toBe(false);
    expect(f.writes).toEqual([]);
    expect(f.outputs.size).toBe(0);
  });

  test('a push or opt-out during approval prevents deployment outputs', async () => {
    for (const action of ['push', 'unlabel']) {
      const f = fixture();
      let pullReads = 0;
      f.beforeRead((path) => {
        if (path === '/pulls/42' && ++pullReads === 2) {
          if (action === 'push') f.pull.head.sha = PREVIOUS;
          else f.pull.labels = [];
        }
      });
      await expect(approve(f)).rejects.toThrow('no longer matches');
      expect(f.writes).toEqual([]);
      expect(f.outputs.size).toBe(0);
    }
  });

  test('unsafe run identifiers are rejected before any API lookup', async () => {
    const f = fixture();
    for (const runId of ['0', '00123', '../pulls/42', '123\nhead-sha=bad'])
      await expect(
        selectMaintainerPreview(
          { repository: REPOSITORY, runId },
          f.dependencies,
        ),
      ).rejects.toThrow('positive integer');
    expect(await select(f)).toEqual({ prNumber: '42', headSha: HEAD });
  });
});

describe('maintainer preview lifetime', () => {
  test('an authorized CI run can deploy its exact approved source to the preview account', async () => {
    const f = fixture();
    expect(await approve(f)).toBe(true);
    const url = await deployPreviewApp(
      { ...deploymentOptions, app: 'demo' },
      { ...f.dependencies, runProcess: deploymentProcess(f) },
    );
    expect(url).toBe(
      'https://maelstrom-playground-alchemy-pr-42.preview.workers.dev/',
    );
    expect(f.mutations).toEqual(['demo']);
    expect(f.outputs.get('deployment-url')).toBe(url);
  });

  test('revocation between application deployments stops the remaining deployment and cleanup', async () => {
    const f = fixture();
    expect(await approve(f)).toBe(true);
    f.writes.length = 0;
    const run = deploymentProcess(f);
    await expect(
      finishPreviewDeployment(
        {
          ...deploymentOptions,
          demoUrl:
            'https://maelstrom-playground-alchemy-pr-42.preview.workers.dev/',
        },
        {
          ...f.dependencies,
          runProcess: async (options) => {
            const result = await run(options);
            if (options.argv[2] === 'deploy') f.roles.delete('pusher');
            return result;
          },
        },
      ),
    ).rejects.toThrow('Automatic preview CI authority is no longer current');
    expect(f.mutations).toEqual(['www']);
    expect(f.writes).toEqual([]);
  });

  test.each([
    'author',
    'pusher',
    'rerunner',
    'CI',
  ])('a queued deployment stops when %s loses its authority', async (identity) => {
    const f = fixture();
    expect(await approve(f)).toBe(true);
    f.outputs.clear();
    if (identity === 'CI') f.run.status = 'in_progress';
    else f.roles.delete(identity);
    const deploymentDependencies = {
      ...f.dependencies,
      runProcess: async (
        options: Parameters<LifecycleDependencies['runProcess']>[0],
      ) => {
        if (options.argv[0] === '/usr/bin/git')
          return { stdout: options.argv[1] === 'rev-parse' ? HEAD : '' };
        f.mutations.push('deploy');
        throw new Error('Unexpected deployment after revocation');
      },
    };
    await expect(
      deployPreviewApp(
        {
          app: 'demo',
          repository: REPOSITORY,
          prNumber: '42',
          approvedSha: HEAD,
          ciRunId: '123',
          bunExecutable: '/usr/bin/bun',
          sourceRoot: '/tmp/source',
          accountId: 'preview',
          apiToken: 'fake-token',
          expectedAccountId: 'preview',
          workersDevSuffix: 'preview.workers.dev',
        },
        deploymentDependencies,
      ),
    ).rejects.toThrow('Automatic preview CI authority is no longer current');
    expect(f.mutations).toEqual([]);
    expect(f.outputs.size).toBe(0);
  });

  test('a maintainer push retains opt-in and refreshes approval without deploying before CI', async () => {
    const f = fixture();
    expect(
      await invalidatePreviewApproval(
        {
          repository: REPOSITORY,
          prNumber: '42',
          beforeSha: PREVIOUS,
          afterSha: HEAD,
          actor: 'pusher',
        },
        f.dependencies,
      ),
    ).toBe('maintainer-update');
    expect(f.pull.labels).toEqual([{ name: 'deploy-preview' }]);
    expect(parsePreviewComment(f.comment.body)).toEqual({
      approvedSha: HEAD,
      deployedSha: PREVIOUS,
    });
    expect(f.mutations).toEqual([]);
  });

  test('a non-maintainer push still invalidates approval even on a maintainer PR', async () => {
    const f = fixture();
    Object.assign(f.roles.get('pusher')!, {
      permission: 'write',
      role_name: 'write',
    });
    expect(
      await invalidatePreviewApproval(
        {
          repository: REPOSITORY,
          prNumber: '42',
          beforeSha: PREVIOUS,
          afterSha: HEAD,
          actor: 'pusher',
        },
        f.dependencies,
      ),
    ).toBe('removed');
    expect(f.pull.labels).toEqual([]);
    expect(parsePreviewComment(f.comment.body).approvedSha).toBe(PREVIOUS);
  });

  test('a later untrusted push revokes opt-in even when an earlier queued push never updated its marker', async () => {
    const f = fixture();
    Object.assign(f.roles.get('pusher')!, {
      permission: 'write',
      role_name: 'write',
    });
    expect(
      await invalidatePreviewApproval(
        {
          repository: REPOSITORY,
          prNumber: '42',
          beforeSha: 'c'.repeat(40),
          afterSha: HEAD,
          actor: 'pusher',
        },
        f.dependencies,
      ),
    ).toBe('removed');
    expect(f.pull.labels).toEqual([]);
    expect(f.writes).toEqual([
      { path: '/issues/42/labels/deploy-preview', method: 'DELETE' },
    ]);
  });

  test('invalidation preserves a fresh manual approval written during a role lookup', async () => {
    const f = fixture();
    Object.assign(f.roles.get('pusher')!, {
      permission: 'write',
      role_name: 'write',
    });
    f.beforeRead((path) => {
      if (path === '/collaborators/pusher/permission')
        f.comment.body = f.comment.body.replace(PREVIOUS, HEAD);
    });
    expect(
      await invalidatePreviewApproval(
        {
          repository: REPOSITORY,
          prNumber: '42',
          beforeSha: PREVIOUS,
          afterSha: HEAD,
          actor: 'pusher',
        },
        f.dependencies,
      ),
    ).toBe('superseded');
    expect(f.writes).toEqual([]);
    expect(f.pull.labels).toEqual([{ name: 'deploy-preview' }]);
  });

  test('scheduled cleanup preserves the existing preview while maintainer CI is pending or fails', async () => {
    const f = fixture();
    f.run.conclusion = 'failure';
    expect(
      await teardownPreview(
        {
          repository: REPOSITORY,
          prNumber: '42',
          trigger: 'schedule',
          bunExecutable: '/usr/bin/bun',
          accountId: 'preview',
          apiToken: 'fake-token',
          expectedAccountId: 'preview',
          root: '/tmp',
        },
        f.dependencies,
      ),
    ).toEqual({ scope: 'legacy', complete: true });
    expect(f.pull.labels).toEqual([{ name: 'deploy-preview' }]);
    expect(f.writes).toEqual([]);
  });
});
