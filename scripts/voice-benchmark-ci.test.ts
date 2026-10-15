import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readVoiceBenchmarkContext,
  renderDeployedComment,
  VOICE_BENCHMARK_MARKER,
} from './preview-lifecycle.ts';
import {
  cleanupVoiceContainers,
  executeVoiceBenchmark,
  parseVoiceClaim,
  renderVoiceComment,
  runOwnedBenchmark,
  type VoiceCiDependencies,
} from './voice-benchmark-ci.ts';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const repository = 'maelstrom-co/maelstrom';
const options = {
  repository,
  prNumber: '42',
  eventHeadSha: sha,
  workersDevSuffix: 'preview.workers.dev',
};
const metrics = {
  schemaVersion: 1,
  status: 'passed',
  assistant: { p95Ms: 1234, samples: 3 },
  taskBargeIn: { p95Ms: 300, samples: 1 },
  greetingBargeIn: { p95Ms: 400, samples: 1 },
} as const;
const bot = { login: 'github-actions[bot]', type: 'Bot' };

function fixture() {
  const state = {
    sha,
    repository,
    open: true,
    deploy: true,
    bench: true,
    approved: sha as string | undefined,
    deployed: sha as string | undefined,
    request: 100,
    comment: undefined as
      | { id: number; body: string; user: typeof bot }
      | undefined,
    extraComments: [] as { id: number; body: string; user: typeof bot }[],
    history: undefined as unknown[] | undefined,
    pagination: undefined as string | undefined,
    failFinalWrite: false,
    launches: 0,
  };
  const calls: { path: string; method: string }[] = [];
  const dependencies: VoiceCiDependencies = {
    githubToken: 'not-a-secret',
    fetch: Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input.toString());
        const method = init?.method ?? 'GET';
        calls.push({ path: url.pathname, method });
        if (url.pathname.endsWith('/pulls/42'))
          return Response.json({
            state: state.open ? 'open' : 'closed',
            head: {
              sha: state.sha,
              ref: 'feature',
              repo: { full_name: state.repository },
            },
            labels: [
              ...(state.deploy ? [{ name: 'deploy-preview' }] : []),
              ...(state.bench ? [{ name: 'bench-voice' }] : []),
            ],
          });
        if (url.pathname.endsWith('/issues/42/events'))
          return Response.json(
            state.history ?? [
              {
                id: 99,
                event: 'labeled',
                label: { name: 'deploy-preview' },
              },
              {
                id: state.request,
                event: 'labeled',
                label: { name: 'bench-voice' },
              },
            ],
            state.pagination
              ? { headers: { link: state.pagination } }
              : undefined,
          );
        if (method === 'GET' && url.pathname.endsWith('/issues/42/comments')) {
          const preview = renderDeployedComment({
            approvedSha: state.approved ?? '',
            deployedSha: state.deployed ?? '',
            demoUrl:
              'https://maelstrom-playground-alchemy-pr-42.preview.workers.dev/',
            docsUrl:
              'https://maelstrom-docs-alchemy-pr-42.preview.workers.dev/',
            wwwUrl: 'https://maelstrom-www-alchemy-pr-42.preview.workers.dev/',
          });
          const body =
            state.approved && state.deployed
              ? preview
              : '<!-- pr-preview-demo -->';
          return Response.json([
            { id: 1, body, user: bot },
            ...(state.comment ? [state.comment] : []),
            ...state.extraComments,
          ]);
        }
        if (
          (method === 'POST' && url.pathname.endsWith('/issues/42/comments')) ||
          (method === 'PATCH' && url.pathname.endsWith('/issues/comments/2'))
        ) {
          if (method === 'PATCH' && state.failFinalWrite)
            return new Response('', { status: 500 });
          state.comment = {
            id: 2,
            body: JSON.parse(String(init?.body)).body,
            user: bot,
          };
          return Response.json(state.comment);
        }
        throw new Error(`Unexpected test request ${method} ${url.pathname}`);
      },
      globalThis.fetch,
    ),
    run: async () => {
      expect(parseVoiceClaim(state.comment?.body)).toEqual({
        sha,
        requestId: state.request,
        status: 'started',
      });
      state.launches++;
      return metrics;
    },
    sleep: (_ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      }),
  };
  const execute = () =>
    executeVoiceBenchmark(options, dependencies, new AbortController().signal);
  return { state, calls, dependencies, execute };
}

describe('voice benchmark CI eligibility and idempotence', () => {
  test('claims before paid execution and upserts one comment with only the three p95 metrics', async () => {
    const f = fixture();
    expect(await f.execute()).toBe('passed');
    expect(f.state.launches).toBe(1);
    expect(f.state.comment?.body).toContain(
      'Assistant response | 1234.0 ms | 3',
    );
    expect(f.state.comment?.body).toContain(
      'Barge-in: task response | 300.0 ms',
    );
    expect(f.state.comment?.body).toContain('Barge-in: greeting | 400.0 ms');
    expect(f.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(f.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    expect(await f.execute()).toBe('skipped');
    expect(f.state.launches).toBe(1);
  });

  test('manual dispatch resolves the current approved head without accepting a caller-supplied SHA', async () => {
    const f = fixture();
    const context = await readVoiceBenchmarkContext(
      {
        repository,
        prNumber: '42',
        workersDevSuffix: options.workersDevSuffix,
      },
      f.dependencies,
    );
    expect(context?.sha).toBe(sha);
    expect(
      await executeVoiceBenchmark(
        {
          repository,
          prNumber: '42',
          workersDevSuffix: options.workersDevSuffix,
        },
        f.dependencies,
        new AbortController().signal,
      ),
    ).toBe('passed');
    expect(f.state.launches).toBe(1);
  });

  test('handles either label order without waiting for deployment while holding its lock', async () => {
    const before = fixture();
    before.state.deployed = undefined;
    expect(await before.execute()).toBe('skipped');
    before.state.deployed = sha;
    expect(await before.execute()).toBe('passed');
    const after = fixture();
    after.state.bench = false;
    expect(await after.execute()).toBe('skipped');
    after.state.bench = true;
    expect(await after.execute()).toBe('passed');
  });

  test('rejects absent labels, forks, closed PRs and stale or unapproved heads before launching', async () => {
    for (const change of [
      { bench: false },
      { deploy: false },
      { repository: 'outsider/fork' },
      { open: false },
      { sha: other },
      { approved: other },
      { deployed: other },
    ]) {
      const f = fixture();
      Object.assign(f.state, change);
      expect(await f.execute()).toBe('skipped');
      expect(f.state.launches).toBe(0);
    }
  });

  test('an abandoned started claim suppresses automatic retries; relabeling is an explicit new request', async () => {
    const f = fixture();
    f.state.comment = {
      id: 2,
      body: renderVoiceComment({ sha, requestId: 100, status: 'started' }),
      user: bot,
    };
    expect(await f.execute()).toBe('skipped');
    f.state.request++;
    expect(await f.execute()).toBe('passed');
  });

  for (const label of ['deploy-preview', 'bench-voice'] as const) {
    test(`a rapid ${label} toggle aborts the previous run and replaces it after cleanup`, async () => {
      const f = fixture();
      const order: string[] = [];
      const dependencies: VoiceCiDependencies = {
        ...f.dependencies,
        sleep: async () => {},
        run: async (context, signal) => {
          if (f.state.launches > 0) {
            order.push('replacement');
            return f.dependencies.run(context, signal);
          }
          f.state.launches++;
          f.state.history = [
            { id: 102, event: 'labeled', label: { name: label } },
            { id: 99, event: 'labeled', label: { name: 'deploy-preview' } },
            { id: 101, event: 'unlabeled', label: { name: label } },
            { id: 100, event: 'labeled', label: { name: 'bench-voice' } },
          ];
          f.state.request = 102;
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          order.push('aborted');
          await Promise.resolve();
          order.push('cleanup');
          throw new Error('revoked');
        },
      };
      expect(
        await executeVoiceBenchmark(
          options,
          dependencies,
          new AbortController().signal,
        ),
      ).toBe('failed');
      expect(f.state.bench && f.state.deploy).toBe(true);
      expect(f.state.comment?.body).not.toContain('1234.0 ms');
      expect(
        await executeVoiceBenchmark(
          options,
          dependencies,
          new AbortController().signal,
        ),
      ).toBe('passed');
      expect(order).toEqual(['aborted', 'cleanup', 'replacement']);
      expect(f.state.launches).toBe(2);
      expect(await f.execute()).toBe('skipped');
      expect(f.state.launches).toBe(2);
    });

    test(`${label} removal stops work without launching a replacement`, async () => {
      const f = fixture();
      let aborted = false;
      const dependencies: VoiceCiDependencies = {
        ...f.dependencies,
        sleep: async () => {},
        run: async (_context, signal) => {
          f.state.launches++;
          if (label === 'deploy-preview') f.state.deploy = false;
          else f.state.bench = false;
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          aborted = true;
          throw new Error('revoked');
        },
      };
      expect(
        await executeVoiceBenchmark(
          options,
          dependencies,
          new AbortController().signal,
        ),
      ).toBe('failed');
      expect(aborted).toBe(true);
      expect(await f.execute()).toBe('skipped');
      expect(f.state.launches).toBe(1);
      expect(f.state.comment?.body).not.toContain('1234.0 ms');
    });
  }

  test('unrelated labels cannot invalidate or repeat an already claimed request', async () => {
    const f = fixture();
    expect(await f.execute()).toBe('passed');
    f.state.history = [
      { id: 99, event: 'labeled', label: { name: 'deploy-preview' } },
      { id: 100, event: 'labeled', label: { name: 'bench-voice' } },
      { id: 999, event: 'labeled', label: { name: 'unrelated' } },
    ];
    expect(await f.execute()).toBe('skipped');
    expect(f.state.launches).toBe(1);
  });

  test('both label histories must be complete and agree with live eligibility', async () => {
    for (const label of ['deploy-preview', 'bench-voice']) {
      const f = fixture();
      f.state.history = [{ id: 100, event: 'labeled', label: { name: label } }];
      await expect(f.execute()).rejects.toThrow('history is incomplete');
      f.state.history.push({
        id: 101,
        event: 'unlabeled',
        label: {
          name: label === 'bench-voice' ? 'deploy-preview' : 'bench-voice',
        },
      });
      expect(await f.execute()).toBe('skipped');
      expect(f.state.launches).toBe(0);
    }
  });

  test('runner failure stays failed with N/A metrics and is not automatically repeated', async () => {
    const f = fixture();
    f.dependencies = {
      ...f.dependencies,
      run: async () => {
        f.state.launches++;
        throw new Error('secret-canary raw error');
      },
    };
    expect(
      await executeVoiceBenchmark(
        options,
        f.dependencies,
        new AbortController().signal,
      ),
    ).toBe('failed');
    expect(f.state.comment?.body).toContain('Status: failed');
    expect(f.state.comment?.body).not.toContain('secret-canary');
    expect(f.state.comment?.body).not.toContain('1234');
    expect(
      await executeVoiceBenchmark(
        options,
        f.dependencies,
        new AbortController().signal,
      ),
    ).toBe('skipped');
    expect(f.state.launches).toBe(1);
  });

  test('failed result publication leaves a durable claim and prevents a duplicate paid run', async () => {
    const f = fixture();
    f.state.failFinalWrite = true;
    await expect(f.execute()).rejects.toThrow();
    expect(parseVoiceClaim(f.state.comment?.body)?.status).toBe('started');
    expect(await f.execute()).toBe('skipped');
    expect(f.state.launches).toBe(1);
  });

  test('new head during execution cannot overwrite the previous request with stale results', async () => {
    const f = fixture();
    const dependencies = {
      ...f.dependencies,
      run: async () => {
        f.state.sha = other;
        return metrics;
      },
    };
    expect(
      await executeVoiceBenchmark(
        options,
        dependencies,
        new AbortController().signal,
      ),
    ).toBe('failed');
    expect(parseVoiceClaim(f.state.comment?.body)?.status).toBe('started');
    expect(f.calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  test('label revocation aborts an active owned run and never publishes metrics', async () => {
    const f = fixture();
    let aborted = false;
    const dependencies = {
      ...f.dependencies,
      sleep: async () => {},
      run: async (_context: unknown, signal: AbortSignal) => {
        f.state.bench = false;
        return new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('aborted'));
            },
            { once: true },
          ),
        );
      },
    };
    expect(
      await executeVoiceBenchmark(
        options,
        dependencies,
        new AbortController().signal,
      ),
    ).toBe('failed');
    expect(aborted).toBe(true);
    expect(parseVoiceClaim(f.state.comment?.body)?.status).toBe('started');
  });

  for (const scenario of [
    {
      name: 'transient failures recover and successful reads reset the counter',
      checks: [500, 502, 'owned', 500, 502, 'owned'],
      result: 'passed',
    },
    {
      name: 'three consecutive read failures revoke the run',
      checks: [500, 502, 503],
      result: 'failed',
    },
    {
      name: 'confirmed ownership loss revokes without waiting for the failure threshold',
      checks: [500, 'revoked'],
      result: 'failed',
    },
  ] as const) {
    test(scenario.name, async () => {
      const f = fixture();
      let monitoring = false;
      let polls = 0;
      let reads = 0;
      let aborted = false;
      let cleaned = false;
      let monitorSignal: AbortSignal | undefined;
      let finishRun!: () => void;
      const completion = new Promise<typeof metrics>((resolve) => {
        finishRun = () => resolve(metrics);
      });
      const dependencies: VoiceCiDependencies = {
        ...f.dependencies,
        sleep: async (ms, signal) => {
          expect(ms).toBe(30_000);
          monitorSignal = signal;
          polls++;
          if (polls > scenario.checks.length) {
            finishRun();
            await f.dependencies.sleep(ms, signal);
          }
        },
        fetch: Object.assign(
          async (input: string | URL | Request, init?: RequestInit) => {
            if (
              monitoring &&
              new URL(input.toString()).pathname.endsWith('/pulls/42')
            ) {
              reads++;
              const check = scenario.checks[polls - 1];
              if (typeof check === 'number')
                return new Response('', { status: check });
              if (check === 'revoked') f.state.bench = false;
            }
            return f.dependencies.fetch(input, init);
          },
          globalThis.fetch,
        ),
        run: async (_context, signal) => {
          monitoring = true;
          const abort = () => {
            aborted = true;
            finishRun();
          };
          signal.addEventListener('abort', abort, { once: true });
          try {
            return await completion;
          } finally {
            monitoring = false;
            cleaned = true;
            signal.removeEventListener('abort', abort);
          }
        },
      };
      expect(
        await executeVoiceBenchmark(
          options,
          dependencies,
          new AbortController().signal,
        ),
      ).toBe(scenario.result);
      expect(reads).toBe(scenario.checks.length);
      expect(polls).toBe(
        scenario.checks.length + (scenario.result === 'passed' ? 1 : 0),
      );
      expect(aborted).toBe(scenario.result === 'failed');
      expect(cleaned).toBe(true);
      expect(monitorSignal?.aborted).toBe(true);
      expect(parseVoiceClaim(f.state.comment?.body)?.status).toBe(
        scenario.result === 'passed' ? 'completed' : 'started',
      );
      expect(f.calls.filter((call) => call.method === 'PATCH')).toHaveLength(
        scenario.result === 'passed' ? 1 : 0,
      );
    });
  }

  test('finishing the run aborts an in-flight monitor read without retrying', async () => {
    const f = fixture();
    let monitoring = false;
    let reads = 0;
    let readAborted = false;
    let finishRun!: () => void;
    const completion = new Promise<typeof metrics>((resolve) => {
      finishRun = () => resolve(metrics);
    });
    const dependencies: VoiceCiDependencies = {
      ...f.dependencies,
      sleep: async () => {},
      fetch: Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          if (
            monitoring &&
            new URL(input.toString()).pathname.endsWith('/pulls/42')
          ) {
            reads++;
            finishRun();
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                'abort',
                () => {
                  readAborted = true;
                  reject(new Error('monitor stopped'));
                },
                { once: true },
              );
            });
          }
          return f.dependencies.fetch(input, init);
        },
        globalThis.fetch,
      ),
      run: async () => {
        monitoring = true;
        try {
          return await completion;
        } finally {
          monitoring = false;
        }
      },
    };
    expect(
      await executeVoiceBenchmark(
        options,
        dependencies,
        new AbortController().signal,
      ),
    ).toBe('passed');
    expect(reads).toBe(1);
    expect(readAborted).toBe(true);
  });

  test('malformed, duplicate or future claims fail closed before execution', async () => {
    for (const body of [
      VOICE_BENCHMARK_MARKER,
      renderVoiceComment({ sha, requestId: 999, status: 'started' }),
      `${renderVoiceComment({ sha, requestId: 90, status: 'failed' })}\n<!-- voice-benchmark-state {} -->`,
    ]) {
      const f = fixture();
      f.state.comment = { id: 2, body, user: bot };
      await expect(f.execute()).rejects.toThrow();
      expect(f.state.launches).toBe(0);
    }
    const f = fixture();
    f.state.extraComments.push(
      {
        id: 3,
        body: renderVoiceComment({ sha, requestId: 90, status: 'failed' }),
        user: bot,
      },
      {
        id: 4,
        body: renderVoiceComment({ sha, requestId: 91, status: 'failed' }),
        user: bot,
      },
    );
    await expect(f.execute()).rejects.toThrow('Multiple authoritative');
  });

  test('the demo URL must match the exact PR worker and configured preview account', async () => {
    const f = fixture();
    await expect(
      readVoiceBenchmarkContext(
        { ...options, workersDevSuffix: 'wrong.workers.dev' },
        f.dependencies,
      ),
    ).rejects.toThrow('Preview state URL');
    expect(f.state.launches).toBe(0);
  });

  test('ambiguous or cyclic label event history is not treated as a fresh request', async () => {
    const f = fixture();
    f.state.history = [
      { id: 100, event: 'labeled', label: { name: 'bench-voice' } },
      { id: 100, event: 'labeled', label: { name: 'bench-voice' } },
    ];
    await expect(f.execute()).rejects.toThrow('Ambiguous');
    f.state.history = undefined;
    f.state.pagination = `<https://api.github.com/repos/${repository}/issues/42/events?per_page=100>; rel="next"`;
    await expect(f.execute()).rejects.toThrow('cyclic');
    f.state.pagination = '<https://attacker.invalid/events>; rel="next"';
    await expect(f.execute()).rejects.toThrow('pagination');
    expect(f.state.launches).toBe(0);
  });

  for (const prefix of [`/repos/${repository}`, '/repositories/123456']) {
    test(`follows exact comments and events pagination under ${prefix} using the configured repository`, async () => {
      const f = fixture();
      const requests: URL[] = [];
      const dependencies = {
        ...f.dependencies,
        fetch: Object.assign(
          async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(input.toString());
            requests.push(url);
            const endpoint = url.pathname.endsWith('/comments')
              ? 'comments'
              : url.pathname.endsWith('/events')
                ? 'events'
                : undefined;
            if (endpoint) {
              if (url.searchParams.get('page') === '2') {
                return Response.json(
                  endpoint === 'comments'
                    ? []
                    : [
                        {
                          id: 101,
                          event: 'labeled',
                          label: { name: 'bench-voice' },
                        },
                      ],
                );
              }
              const response = await f.dependencies.fetch(input, init);
              response.headers.set(
                'link',
                `<https://api.github.com${prefix}/issues/42/${endpoint}?per_page=100&page=2>; rel="next"`,
              );
              return response;
            }
            return f.dependencies.fetch(input, init);
          },
          globalThis.fetch,
        ),
      };
      const context = await readVoiceBenchmarkContext(options, dependencies);
      expect(context?.requestId).toBe(101);
      expect(
        requests
          .filter((url) => url.searchParams.get('page') === '2')
          .map((url) => `${url.pathname}${url.search}`),
      ).toEqual([
        `/repos/${repository}/issues/42/comments?per_page=100&page=2`,
        `/repos/${repository}/issues/42/events?per_page=100&page=2`,
        `/repos/${repository}/issues/42/comments?per_page=100&page=2`,
      ]);
    });
  }

  test('rejects pagination outside the exact endpoint and trusted origin without following it', async () => {
    for (const next of [
      `https://api.github.com/repos/other/repository/issues/42/events?page=2`,
      `https://api.github.com/repos/${repository}/issues/43/events?page=2`,
      'https://api.github.com/repositories/123/issues/42/comments?page=2',
      'https://api.github.com/repositories/123/issues/43/events?page=2',
      'https://api.github.com/repositories/123/issues/42/events/extra?page=2',
      'https://api.github.com/repositories/123abc/issues/42/events?page=2',
      'https://api.github.com/repositories/-123/issues/42/events?page=2',
      'https://api.github.com/repositories/123/issues/42/events%2F?page=2',
      'https://api.github.com/repositories/123/issues/42/events/?page=2',
      'https://attacker.invalid/repositories/123/issues/42/events?page=2',
      'http://api.github.com/repositories/123/issues/42/events?page=2',
      'https://api.github.com:444/repositories/123/issues/42/events?page=2',
      'https://user:password@api.github.com/repositories/123/issues/42/events?page=2',
    ]) {
      const f = fixture();
      f.state.pagination = `<${next}>; rel="next"`;
      await expect(f.execute()).rejects.toThrow('pagination URL');
      expect(f.calls).toHaveLength(3);
      expect(f.state.launches).toBe(0);
    }
  });

  test('a user-authored marker does not become an authoritative benchmark claim', async () => {
    const f = fixture();
    f.state.comment = {
      id: 2,
      body: renderVoiceComment({ sha, requestId: 100, status: 'completed' }),
      user: { login: 'contributor', type: 'User' },
    };
    expect(await f.execute()).toBe('passed');
  });

  test('a removed and reapplied label cannot accept a previous request result', async () => {
    const f = fixture();
    const dependencies = {
      ...f.dependencies,
      run: async () => {
        f.state.request++;
        return metrics;
      },
    };
    expect(
      await executeVoiceBenchmark(
        options,
        dependencies,
        new AbortController().signal,
      ),
    ).toBe('failed');
    expect(parseVoiceClaim(f.state.comment?.body)?.requestId).toBe(100);
  });
});

describe('owned Docker cleanup', () => {
  test('revocation kills the owned process group, cleans containers and does not forward GitHub credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voice-owned-run-'));
    const abort = new AbortController();
    const cleanups: string[] = [];
    let completed = false;
    try {
      await mkdir(join(root, 'scripts'), { recursive: true });
      await writeFile(join(root, 'scripts/preview-lifecycle.bunfig.toml'), '');
      await mkdir(join(root, 'apps/demo/e2e/voice'), { recursive: true });
      await writeFile(
        join(root, 'apps/demo/e2e/voice/run-tests.ts'),
        `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'ignore' }); writeFileSync('owned.json', JSON.stringify({ pid: process.pid, child: child.pid, github: process.env.GH_TOKEN, cloudflare: process.env.CLOUDFLARE_API_TOKEN, key: process.env.MAELSTROM_E2E_OPENAI_API_KEY, single: process.env.VOICE_BENCHMARK_SINGLE_TURN })); setInterval(()=>{},1000);`,
      );
      const run = runOwnedBenchmark({
        root,
        runId: 'test-owned',
        target: 'https://example.invalid/',
        environment: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          MAELSTROM_E2E_OPENAI_API_KEY: 'test-key',
          ELEVENLABS_API_KEY: 'test-tts',
          GH_TOKEN: 'must-not-forward',
          CLOUDFLARE_API_TOKEN: 'must-not-forward',
          VOICE_BENCHMARK_SINGLE_TURN: '1',
        },
        signal: abort.signal,
        terminationGraceMs: 100,
        cleanup: async (id) => {
          cleanups.push(id);
        },
      }).finally(() => {
        completed = true;
      });
      const outcome = run.then(
        () => undefined,
        (error: unknown) => error,
      );
      let owned:
        | {
            pid: number;
            child: number;
            key: string;
            github?: string;
            cloudflare?: string;
            single?: string;
          }
        | undefined;
      for (let attempt = 0; attempt < 100 && !owned; attempt++) {
        try {
          owned = JSON.parse(await readFile(join(root, 'owned.json'), 'utf8'));
        } catch {
          await Bun.sleep(20);
        }
      }
      expect(owned).toBeDefined();
      abort.abort();
      expect(await outcome).toBeInstanceOf(Error);
      expect(completed).toBe(true);
      expect(owned?.key).toBe('test-key');
      expect(owned?.github).toBeUndefined();
      expect(owned?.cloudflare).toBeUndefined();
      expect(owned?.single).toBeUndefined();
      expect(cleanups).toEqual(['test-owned']);
      for (const pid of [owned?.pid, owned?.child]) {
        if (!pid) throw new Error('Missing owned process identity');
        let alive = true;
        for (let attempt = 0; attempt < 100 && alive; attempt++) {
          try {
            process.kill(pid, 0);
            await Bun.sleep(10);
          } catch {
            alive = false;
          }
        }
        expect(alive).toBe(false);
      }
    } finally {
      abort.abort();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('uses only an exact validated lease and the returned container IDs', async () => {
    const calls: string[][] = [];
    await cleanupVoiceContainers('pr-42-run-1', async (args) => {
      calls.push(args);
      return args[0] === 'ps' ? 'abcdef123456\n123456abcdef\n' : '';
    });
    expect(calls).toEqual([
      ['ps', '-aq', '--filter', 'label=maelstrom.voice.ci=pr-42-run-1'],
      ['rm', '--force', 'abcdef123456', '123456abcdef'],
    ]);
    await expect(
      cleanupVoiceContainers('bad,label', async () => ''),
    ).rejects.toThrow('Invalid');
    await expect(
      cleanupVoiceContainers('safe', async () => '--all'),
    ).rejects.toThrow('Invalid');
  });
});
