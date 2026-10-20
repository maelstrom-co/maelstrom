import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readVoiceBenchmarkContext,
  renderDeployedComment,
  VOICE_BENCHMARK_ARCHIVE_MARKER,
  VOICE_BENCHMARK_MARKER,
} from './preview-lifecycle.ts';
import {
  cleanupVoiceContainers,
  executeVoiceBenchmark,
  parseVoiceClaim,
  readManualVoiceRequest,
  renderVoiceComment,
  runOwnedBenchmark,
  type VoiceCiDependencies,
  type VoiceCiOptions,
} from './voice-benchmark-ci.ts';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const repository = 'maelstrom-co/maelstrom';
const runIdentity = { runId: '123456789', runAttempt: '1' };
const provenance = { targetSha: sha, ...runIdentity };
const options = {
  runIdentity,
  repository,
  prNumber: '42',
  eventHeadSha: sha,
  workersDevSuffix: 'preview.workers.dev',
};
const metrics = {
  schemaVersion: 2,
  status: 'passed',
  provenance,
  assistant: { status: 'validated', p95Ms: 1234, samples: 3 },
  taskBargeIn: { status: 'validated', p95Ms: 300, samples: 1 },
  greetingBargeIn: { status: 'validated', p95Ms: 400, samples: 1 },
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
    archives: new Map<
      number,
      { id: number; body: string; user: typeof bot; issue_url: string }
    >(),
    nextArchiveId: 1000,
    history: undefined as unknown[] | undefined,
    pagination: undefined as string | undefined,
    failFinalWrite: false,
    launches: 0,
  };
  const calls: { path: string; method: string }[] = [];
  const logs: string[] = [];
  const dependencies: VoiceCiDependencies = {
    log: (line) => logs.push(line),
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
            ...state.archives.values(),
          ]);
        }
        if (method === 'GET' && /\/issues\/comments\/\d+$/.test(url.pathname)) {
          const comment = state.archives.get(
            Number(url.pathname.split('/').at(-1)),
          );
          return comment
            ? Response.json(comment)
            : new Response('', { status: 404 });
        }
        if (method === 'POST' && url.pathname.endsWith('/issues/42/comments')) {
          const body = JSON.parse(String(init?.body)).body as string;
          if (body.startsWith(VOICE_BENCHMARK_ARCHIVE_MARKER)) {
            const archive = {
              id: state.nextArchiveId++,
              body,
              user: bot,
              issue_url: `https://api.github.com/repos/${repository}/issues/42`,
            };
            state.archives.set(archive.id, archive);
            return Response.json(archive);
          }
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
    run: async (_context, _signal, currentProvenance) => {
      expect(parseVoiceClaim(state.comment?.body)).toMatchObject({
        sha,
        requestId: state.request,
        status: 'started',
      });
      state.launches++;
      return { ...metrics, provenance: currentProvenance };
    },
    sleep: (_ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      }),
  };
  const execute = () =>
    executeVoiceBenchmark(options, dependencies, new AbortController().signal);
  return { state, calls, logs, dependencies, execute };
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
          runIdentity,
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
        run: async (context, signal, currentProvenance) => {
          if (f.state.launches > 0) {
            order.push('replacement');
            return f.dependencies.run(context, signal, currentProvenance);
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
    expect(f.logs.join('\n')).toContain('"category":"unexpected-error"');
    expect(f.logs.join('\n')).not.toContain('secret-canary');
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
    expect(f.logs.join('\n')).toContain(
      '"phase":"publication","category":"unexpected-error"',
    );
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
    expect(f.logs.join('\n')).toContain(
      '"phase":"claim-monitor","category":"claim-lost"',
    );
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
      expect(
        f.logs.filter((line) =>
          line.includes('"category":"claim-check-failed"'),
        ),
      ).toHaveLength(
        scenario.checks.filter((check) => typeof check === 'number').length,
      );
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
      `${renderVoiceComment({ sha, requestId: 90, status: 'failed' })}\n<!-- voice-benchmark-state corrupted -->`,
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

describe('partial lane publication', () => {
  test('an individually valid lane is published while invalid siblings keep the job and claim failed', async () => {
    for (const lane of [
      'assistant',
      'taskBargeIn',
      'greetingBargeIn',
    ] as const) {
      const f = fixture();
      const partial = {
        ...metrics,
        status: 'failed',
        [lane]: { status: 'unavailable', reason: 'benchmark-failed' },
      };
      const outcome = await executeVoiceBenchmark(
        options,
        { ...f.dependencies, run: async () => partial },
        new AbortController().signal,
      );
      expect(outcome).toBe('failed');
      expect(f.state.comment?.body).toContain('Status: failed');
      const rows = {
        assistant: ['Assistant response', '1234.0'],
        taskBargeIn: ['Barge-in: task response', '300.0'],
        greetingBargeIn: ['Barge-in: greeting', '400.0'],
      };
      for (const [key, [title, value]] of Object.entries(rows))
        expect(f.state.comment?.body).toContain(
          `${title} | ${key === lane ? 'N/A' : `${value} ms`}`,
        );
      expect(await f.execute()).toBe('skipped');
    }
  });
  test('nonzero owned runner exit publishes current partial metrics and returns a failed job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voice-partial-publication-'));
    try {
      await mkdir(join(root, 'scripts'), { recursive: true });
      await writeFile(join(root, 'scripts/preview-lifecycle.bunfig.toml'), '');
      await mkdir(join(root, 'apps/demo/e2e/voice'), { recursive: true });
      const partial = {
        ...metrics,
        status: 'failed',
        greetingBargeIn: { status: 'unavailable', reason: 'benchmark-failed' },
      };
      await writeFile(
        join(root, 'apps/demo/e2e/voice/run-tests.ts'),
        `import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('apps/demo/dist/docker-voice', {recursive:true}); writeFileSync('apps/demo/dist/docker-voice/voice-benchmark-metrics.json', ${JSON.stringify(JSON.stringify(partial))}); process.exitCode=17;`,
      );
      const f = fixture();
      const result = await executeVoiceBenchmark(
        options,
        {
          ...f.dependencies,
          run: (context, signal, currentProvenance) =>
            runOwnedBenchmark({
              root,
              runId: 'partial-publication',
              target: context.url,
              signal,
              provenance: currentProvenance,
              environment: {
                MAELSTROM_E2E_OPENAI_API_KEY: 'fake-key',
                ELEVENLABS_API_KEY: 'fake-tts',
              },
              cleanup: async () => {},
              log: (line) => f.logs.push(line),
            }),
        },
        new AbortController().signal,
      );
      expect(result).toBe('failed');
      expect(f.state.comment?.body).toContain('Assistant response | 1234.0 ms');
      expect(f.state.comment?.body).toContain(
        'Barge-in: task response | 300.0 ms',
      );
      expect(f.state.comment?.body).toContain('Barge-in: greeting | N/A');
      expect(f.state.comment?.body).toContain('Status: failed');
      expect(f.state.comment?.body).toContain(
        'Barge-in: greeting: benchmark-failed',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('missing, malformed and mismatched current-attempt envelopes never publish any numbers', async () => {
    for (const value of [
      undefined,
      {},
      { ...metrics, provenance: { ...provenance, targetSha: other } },
      { ...metrics, provenance: { ...provenance, runId: '999' } },
      { ...metrics, provenance: { ...provenance, runAttempt: '2' } },
    ]) {
      const f = fixture();
      expect(
        await executeVoiceBenchmark(
          options,
          { ...f.dependencies, run: async () => value },
          new AbortController().signal,
        ),
      ).toBe('failed');
      expect(f.state.comment?.body).toContain('Status: failed');
      expect(f.state.comment?.body?.match(/\| N\/A \|/g)).toHaveLength(3);
    }
  });
  test('early runner failure still produces an all-unavailable failed comment', async () => {
    const f = fixture();
    expect(
      await executeVoiceBenchmark(
        options,
        {
          ...f.dependencies,
          run: async () => {
            throw new Error('early build failure');
          },
        },
        new AbortController().signal,
      ),
    ).toBe('failed');
    expect(f.state.comment?.body?.match(/\| N\/A \|/g)).toHaveLength(3);
    expect(f.state.comment?.body).not.toContain('early build failure');
  });
});

describe('explicit paid workflow attempts', () => {
  const manualOptions = (
    runId = '123456789',
    runAttempt = '1',
  ): VoiceCiOptions => ({
    repository,
    prNumber: '42',
    workersDevSuffix: options.workersDevSuffix,
    manualRequest: { runId, runAttempt },
    runIdentity: { runId, runAttempt },
  });
  const execute = (
    f: ReturnType<typeof fixture>,
    configuration = manualOptions(),
    dependencies = f.dependencies,
  ) =>
    executeVoiceBenchmark(
      configuration,
      dependencies,
      new AbortController().signal,
    );

  test('each opted-in Actions attempt runs once without replaying older attempts or label requests', async () => {
    const f = fixture();
    expect(await f.execute()).toBe('passed');
    expect(await execute(f)).toBe('passed');
    expect(await execute(f)).toBe('skipped');
    expect(await execute(f, manualOptions('123456789', '2'))).toBe('passed');
    expect(await execute(f)).toBe('skipped');
    expect(await execute(f, manualOptions('123456789', '2'))).toBe('skipped');
    expect(await f.execute()).toBe('skipped');
    // A different dispatch cannot forget consumption of an earlier workflow.
    expect(await execute(f, manualOptions('987654321'))).toBe('passed');
    expect(await execute(f, manualOptions('123456789', '2'))).toBe('skipped');
    expect(f.state.launches).toBe(4);
    expect(parseVoiceClaim(f.state.comment?.body)).toMatchObject({
      requestId: 100,
      execution: 'manual:987654321:1',
      consumed: [
        `label:${sha}:100`,
        'manual:123456789:1',
        'manual:123456789:2',
        'manual:987654321:1',
      ],
    });
  });

  test('a manual request also consumes an unclaimed label and retains attempts across new label epochs and heads', async () => {
    const f = fixture();
    expect(await execute(f)).toBe('passed');
    expect(await f.execute()).toBe('skipped');
    f.state.request++;
    expect(await f.execute()).toBe('passed');
    expect(await execute(f)).toBe('skipped');
    f.state.sha = other;
    f.state.approved = other;
    f.state.deployed = other;
    expect(await execute(f)).toBe('skipped');
    const currentHead: VoiceCiDependencies = {
      ...f.dependencies,
      run: async (_context, _signal, currentProvenance) => {
        f.state.launches++;
        return { ...metrics, provenance: currentProvenance };
      },
    };
    expect(await execute(f, manualOptions('123456789', '2'), currentHead)).toBe(
      'passed',
    );
    expect(
      await execute(f, { ...options, eventHeadSha: other }, currentHead),
    ).toBe('skipped');
    expect(f.state.launches).toBe(3);
  });

  for (const status of ['started', 'completed', 'failed'] as const) {
    test(`legacy ${status} consumption survives an explicit fresh attempt`, async () => {
      const f = fixture();
      f.state.comment = {
        id: 2,
        user: bot,
        body: renderVoiceComment({ sha, requestId: 100, status }),
      };
      expect(await f.execute()).toBe('skipped');
      expect(await execute(f)).toBe('passed');
      expect(await f.execute()).toBe('skipped');
      expect(await execute(f)).toBe('skipped');
      expect(f.state.launches).toBe(1);
    });
  }

  test('failed or abandoned manual attempts remain consumed but the next attempt may run', async () => {
    for (const failPublication of [false, true]) {
      const f = fixture();
      // Prime the comment so final-write failure does not affect the initial POST.
      expect(await f.execute()).toBe('passed');
      const dependencies = {
        ...f.dependencies,
        run: async () => {
          f.state.launches++;
          if (failPublication) f.state.failFinalWrite = true;
          throw new Error('failed benchmark');
        },
      };
      if (failPublication)
        await expect(
          execute(f, manualOptions(), dependencies),
        ).rejects.toThrow();
      else
        expect(await execute(f, manualOptions(), dependencies)).toBe('failed');
      f.state.failFinalWrite = false;
      expect(await execute(f)).toBe('skipped');
      expect(await execute(f, manualOptions('123456789', '2'))).toBe('passed');
      expect(await execute(f)).toBe('skipped');
      expect(f.state.launches).toBe(3);
    }
  });

  test('opt-in never bypasses PR, label, preview URL or approval eligibility', async () => {
    for (const change of [
      { bench: false },
      { deploy: false },
      { open: false },
      { repository: 'outsider/fork' },
      { approved: other },
      { deployed: other },
    ]) {
      const f = fixture();
      Object.assign(f.state, change);
      expect(await execute(f)).toBe('skipped');
      expect(f.state.launches).toBe(0);
    }
    const f = fixture();
    await expect(
      execute(f, { ...manualOptions(), workersDevSuffix: 'wrong.workers.dev' }),
    ).rejects.toThrow('Preview state URL');
    await expect(
      execute(f, { ...manualOptions(), eventHeadSha: sha }),
    ).rejects.toThrow('PR event head');
    expect(f.state.launches).toBe(0);
  });

  for (const change of [
    'bench',
    'deploy',
    'epoch',
    'head',
    'approval',
    'claim',
  ] as const) {
    test(`manual work loses ownership on ${change}, cleans up, and cannot publish`, async () => {
      const f = fixture();
      const order: string[] = [];
      const dependencies: VoiceCiDependencies = {
        ...f.dependencies,
        sleep: async () => {},
        run: async (_context, signal) => {
          f.state.launches++;
          if (change === 'bench') f.state.bench = false;
          if (change === 'deploy') f.state.deploy = false;
          if (change === 'epoch') f.state.request++;
          if (change === 'head') f.state.sha = other;
          if (change === 'approval') f.state.approved = other;
          if (change === 'claim') {
            const claim = parseVoiceClaim(f.state.comment?.body)!;
            f.state.comment!.body = renderVoiceComment({
              ...claim,
              execution: 'manual:123456789:2',
              consumed: [...claim.consumed!, 'manual:123456789:2'],
            });
          }
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          order.push('aborted');
          await Promise.resolve();
          order.push('cleanup');
          throw new Error('revoked');
        },
      };
      expect(await execute(f, manualOptions(), dependencies)).toBe('failed');
      expect(order).toEqual(['aborted', 'cleanup']);
      expect(f.state.comment?.body).not.toContain('1234.0 ms');
      expect(f.calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
      if (change === 'epoch') {
        expect(await execute(f)).toBe('skipped');
        expect(
          await execute(f, manualOptions('123456789', '2'), {
            ...f.dependencies,
            run: async (context, signal, currentProvenance) => {
              order.push('replacement');
              return f.dependencies.run(context, signal, currentProvenance);
            },
          }),
        ).toBe('passed');
        expect(order).toEqual(['aborted', 'cleanup', 'replacement']);
      }
    });
  }

  test('corrupted ledgers fail closed rather than forgetting requests', async () => {
    const valid = {
      sha,
      requestId: 100,
      status: 'completed',
      version: 2,
      execution: 'manual:1:1',
      consumed: [`label:${sha}:100`, 'manual:1:1'],
    };
    for (const change of [
      { status: ['completed'] },
      { version: 3 },
      { version: undefined },
      { execution: undefined },
      { consumed: undefined },
      { consumed: [] },
      { consumed: [1] },
      { execution: 'manual:2:1' },
      { consumed: ['manual:1:1'] },
      { consumed: [...valid.consumed, 'manual:1:1'] },
      { consumed: [...valid.consumed, `label:${sha}:101`] },
      { consumed: [...valid.consumed, `label:${sha}:9007199254740992`] },
      { consumed: [...valid.consumed, 'manual:01:1'] },
      { consumed: [...valid.consumed, 'manual:1:1e3'] },
      { extra: true },
    ]) {
      const f = fixture();
      f.state.comment = {
        id: 2,
        user: bot,
        body: `${VOICE_BENCHMARK_MARKER}\n<!-- voice-benchmark-state ${JSON.stringify({ ...valid, ...change })} -->`,
      };
      await expect(execute(f)).rejects.toThrow();
      expect(f.state.launches).toBe(0);
      expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
    }
  });

  const fullLedger = () => {
    const f = fixture();
    const consumed = [
      `label:${sha}:100`,
      ...Array.from({ length: 255 }, (_, i) => `manual:${i + 1}:1`),
    ];
    f.state.comment = {
      id: 2,
      user: bot,
      body: renderVoiceComment({
        sha,
        requestId: 100,
        status: 'completed',
        version: 2,
        execution: 'manual:255:1',
        consumed,
      }),
    };
    return f;
  };
  const archiveBody = (overrides: Record<string, unknown> = {}) =>
    `${VOICE_BENCHMARK_ARCHIVE_MARKER}\n${JSON.stringify({
      version: 1,
      repository,
      prNumber: '42',
      requestId: 100,
      consumed: [`label:${sha}:100`, 'manual:1:1'],
      previous: null,
      ...overrides,
    })}`;
  const reference = (commentId: number, body: string) => ({
    commentId,
    sha256: createHash('sha256').update(body).digest('hex'),
  });
  const withArchive = (body = archiveBody()) => {
    const f = fixture();
    f.state.archives.set(1000, {
      id: 1000,
      body,
      user: bot,
      issue_url: `https://api.github.com/repos/${repository}/issues/42`,
    });
    f.state.comment = {
      id: 2,
      user: bot,
      body: renderVoiceComment({
        sha,
        requestId: 100,
        status: 'completed',
        version: 3,
        execution: 'manual:2:1',
        consumed: [`label:${sha}:100`, 'manual:2:1'],
        archive: reference(1000, body),
      }),
    };
    return f;
  };

  test('ongoing attempts roll over multiple durable chunks without replaying old label or workflow requests', async () => {
    const f = fullLedger();
    expect(await execute(f, manualOptions('1'))).toBe('skipped');
    for (let attempt = 1; attempt <= 515; attempt++)
      expect(await execute(f, manualOptions('9000', String(attempt)))).toBe(
        'passed',
      );
    expect(f.state.archives.size).toBe(3);
    expect(f.state.launches).toBe(515);
    const claim = parseVoiceClaim(f.state.comment?.body)!;
    expect(claim.version).toBe(3);
    expect(claim.consumed!.length).toBeLessThanOrEqual(256);
    expect(f.state.comment!.body.length).toBeLessThan(60_000);
    const newest = f.state.archives.get(claim.archive!.commentId)!;
    expect(claim.archive).toEqual(reference(newest.id, newest.body));
    expect(JSON.parse(newest.body.split('\n')[1]!).previous.commentId).toBe(
      1001,
    );
    expect(
      f.calls.filter(
        (call) =>
          call.method === 'PATCH' &&
          call.path !== `/repos/${repository}/issues/comments/2`,
      ),
    ).toEqual([]);
    f.calls.length = 0;
    expect(await execute(f, manualOptions('1'))).toBe('skipped');
    expect(await execute(f, manualOptions('9000', '1'))).toBe('skipped');
    expect(await execute(f, manualOptions('9000', '300'))).toBe('skipped');
    expect(await f.execute()).toBe('skipped');
    expect(f.state.launches).toBe(515);
    // Archives use direct reads, independent of pagination through historical comments.
    expect(
      f.calls.some(
        (call) => call.path === `/repos/${repository}/issues/comments/1000`,
      ),
    ).toBe(true);
    expect(
      f.calls.some(
        (call) => call.path === `/repos/${repository}/issues/comments/1002`,
      ),
    ).toBe(true);
    // Older workflow IDs are not a global high-water mark: a new attempt is eligible.
    expect(await execute(f, manualOptions('1', '2'))).toBe('passed');
    expect(await execute(f, manualOptions('1', '2'))).toBe('skipped');
    f.state.request++;
    expect(await f.execute()).toBe('passed');
    expect(await execute(f, manualOptions('9000', '1'))).toBe('skipped');
    expect(f.state.launches).toBe(517);
  });

  test('archive is written and verified before the new claim; a lost archive response only leaves an orphan', async () => {
    const f = fullLedger();
    const before = f.state.comment!.body;
    const order: string[] = [];
    let fail = true;
    const dependencies = {
      ...f.dependencies,
      fetch: Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          const response = await f.dependencies.fetch(input, init);
          if (init?.method === 'POST') {
            order.push('archive-write');
            expect(f.state.comment!.body).toBe(before);
            if (fail) {
              fail = false;
              return new Response('', { status: 500 });
            }
          }
          if (
            new URL(input.toString()).pathname.endsWith(
              '/issues/comments/1001',
            ) &&
            !init?.method
          )
            order.push('archive-readback');
          if (init?.method === 'PATCH') order.push('claim-write');
          return response;
        },
        globalThis.fetch,
      ),
      run: async (
        context: Parameters<VoiceCiDependencies['run']>[0],
        signal: AbortSignal,
        currentProvenance: typeof provenance,
      ) => {
        order.push('paid-run');
        expect(parseVoiceClaim(f.state.comment!.body)?.archive?.commentId).toBe(
          1001,
        );
        return f.dependencies.run(context, signal, currentProvenance);
      },
    };
    await expect(execute(f, manualOptions(), dependencies)).rejects.toThrow();
    expect(f.state.archives.size).toBe(1);
    expect(f.state.comment!.body).toBe(before);
    expect(f.state.launches).toBe(0);
    expect(await execute(f, manualOptions(), dependencies)).toBe('passed');
    expect(f.state.archives.size).toBe(2);
    expect(order).toEqual([
      'archive-write',
      'archive-write',
      'archive-readback',
      'claim-write',
      'paid-run',
      'claim-write',
    ]);
    expect(await execute(f)).toBe('skipped');
    expect(await execute(f, manualOptions('1'))).toBe('skipped');
  });

  for (const point of [
    'readback',
    'eligibility',
    'before-claim',
    'after-claim',
    'claim-readback',
  ] as const) {
    test(`rollover failure at ${point} cannot discard history or duplicate paid execution`, async () => {
      const f = fullLedger();
      const before = f.state.comment!.body;
      let injected = false;
      let writtenClaim = false;
      const dependencies = {
        ...f.dependencies,
        fetch: Object.assign(
          async (input: string | URL | Request, init?: RequestInit) => {
            const path = new URL(input.toString()).pathname;
            if (
              !injected &&
              point === 'readback' &&
              path.endsWith('/issues/comments/1000')
            ) {
              injected = true;
              return new Response('', { status: 404 });
            }
            if (
              !injected &&
              point === 'before-claim' &&
              init?.method === 'PATCH'
            ) {
              injected = true;
              return new Response('', { status: 500 });
            }
            if (
              !injected &&
              point === 'claim-readback' &&
              writtenClaim &&
              path.endsWith('/pulls/42')
            ) {
              injected = true;
              return new Response('', { status: 500 });
            }
            const response = await f.dependencies.fetch(input, init);
            if (init?.method === 'POST' && point === 'eligibility') {
              injected = true;
              f.state.bench = false;
            }
            if (init?.method === 'PATCH') {
              writtenClaim = true;
              if (!injected && point === 'after-claim') {
                injected = true;
                return new Response('', { status: 500 });
              }
            }
            return response;
          },
          globalThis.fetch,
        ),
      };
      await expect(execute(f, manualOptions(), dependencies)).rejects.toThrow();
      expect(injected).toBe(true);
      expect(f.state.archives.size).toBe(1);
      expect(f.state.launches).toBe(0);
      f.state.bench = true;
      if (point === 'after-claim' || point === 'claim-readback') {
        expect(parseVoiceClaim(f.state.comment!.body)?.archive?.commentId).toBe(
          1000,
        );
        expect(await execute(f)).toBe('skipped');
      } else {
        expect(f.state.comment!.body).toBe(before);
        expect(await execute(f)).toBe('passed');
      }
      expect(await execute(f, manualOptions('1'))).toBe('skipped');
    });
  }

  for (const problem of [
    'missing',
    'hash',
    'author',
    'repository',
    'pr',
    'id',
    'public-marker',
  ] as const) {
    test(`${problem} archive envelope or contents fail closed, including for already consumed requests`, async () => {
      const f = withArchive();
      const comment = f.state.archives.get(1000)!;
      if (problem === 'missing') f.state.archives.delete(1000);
      if (problem === 'hash') comment.body += ' ';
      if (problem === 'author')
        comment.user = { login: 'contributor', type: 'User' };
      if (problem === 'repository')
        comment.issue_url = 'https://api.github.com/repos/other/repo/issues/42';
      if (problem === 'pr')
        comment.issue_url = `https://api.github.com/repos/${repository}/issues/43`;
      if (problem === 'id') comment.id = 1001;
      if (problem === 'public-marker') comment.body += VOICE_BENCHMARK_MARKER;
      await expect(execute(f)).rejects.toThrow();
      await expect(execute(f, manualOptions('1'))).rejects.toThrow();
      expect(f.state.launches).toBe(0);
      expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
    });
  }

  test('archive traversal uses direct IDs even beyond fifty chunks', async () => {
    const f = withArchive();
    let previous: ReturnType<typeof reference> | null = null;
    for (let index = 0; index < 60; index++) {
      const body = archiveBody({
        previous,
        consumed: [`manual:${index + 1}:1`],
      });
      const id = 1000 + index;
      f.state.archives.set(id, {
        id,
        body,
        user: bot,
        issue_url: `https://api.github.com/repos/${repository}/issues/42`,
      });
      previous = reference(id, body);
    }
    f.state.comment!.body = renderVoiceComment({
      ...parseVoiceClaim(f.state.comment!.body)!,
      archive: previous,
    });
    expect(await execute(f, manualOptions('1'))).toBe('skipped');
    expect(
      f.calls.filter((call) => /\/issues\/comments\/\d+$/.test(call.path)),
    ).toHaveLength(60);
    expect(f.state.launches).toBe(0);
  });

  for (const stage of ['create', 'readback'] as const) {
    for (const defect of ['author', 'issue', 'body', 'id'] as const) {
      test(`a changed ${stage} archive ${defect} cannot authorize the new claim`, async () => {
        const f = fullLedger();
        const before = f.state.comment!.body;
        const dependencies = {
          ...f.dependencies,
          fetch: Object.assign(
            async (input: string | URL | Request, init?: RequestInit) => {
              const response = await f.dependencies.fetch(input, init);
              if (
                (stage === 'create' && init?.method === 'POST') ||
                (stage === 'readback' &&
                  new URL(input.toString()).pathname.endsWith(
                    '/issues/comments/1000',
                  ))
              ) {
                const data = (await response.json()) as Record<string, unknown>;
                if (defect === 'author')
                  data.user = { login: 'somebody', type: 'User' };
                if (defect === 'issue')
                  data.issue_url = `https://api.github.com/repos/${repository}/issues/43`;
                if (defect === 'body') data.body = `${String(data.body)} `;
                if (defect === 'id') data.id = 999;
                return Response.json(data);
              }
              return response;
            },
            globalThis.fetch,
          ),
        };
        await expect(
          execute(f, manualOptions(), dependencies),
        ).rejects.toThrow();
        expect(f.state.comment!.body).toBe(before);
        expect(f.state.launches).toBe(0);
        expect(f.calls.some((call) => call.method === 'PATCH')).toBe(false);
      });
    }
  }

  test('invalid archive schemas, identities, predecessor hashes and cycles fail closed', async () => {
    for (const body of [
      `${VOICE_BENCHMARK_ARCHIVE_MARKER}\nnot JSON`,
      ...[
        { version: 2 },
        { repository: 'other/repo' },
        { prNumber: '43' },
        { requestId: 101 },
        { consumed: [] },
        { consumed: ['bad'] },
        { consumed: ['manual:1:1', 'manual:1:1'] },
        { previous: { commentId: 1000, sha256: 'a'.repeat(64) } },
        { previous: { commentId: 0, sha256: 'a'.repeat(64) } },
        { previous: { commentId: 999, sha256: 'bad' } },
        { previous: { commentId: 999, sha256: 'a'.repeat(64), extra: true } },
        { previous: undefined },
        { extra: true },
      ].map(archiveBody),
    ]) {
      const f = withArchive(body);
      await expect(execute(f)).rejects.toThrow();
      expect(f.state.launches).toBe(0);
    }
    // A two-node loop must be rejected before revisiting a referenced comment.
    const older = archiveBody({
      previous: { commentId: 1000, sha256: 'a'.repeat(64) },
    });
    const newer = archiveBody({ previous: reference(1001, older) });
    const f = withArchive(newer);
    f.state.archives.set(1001, {
      id: 1001,
      body: older,
      user: bot,
      issue_url: `https://api.github.com/repos/${repository}/issues/42`,
    });
    await expect(execute(f)).rejects.toThrow('Cyclic');
    expect(
      f.calls.filter((call) => call.path.endsWith('/issues/comments/1000')),
    ).toHaveLength(1);
    // A valid older chunk with a wrong hash or newer label epoch is also rejected.
    for (const previous of [
      reference(1001, 'wrong'),
      reference(1001, archiveBody({ requestId: 101 })),
    ]) {
      const g = withArchive(archiveBody({ previous }));
      g.state.archives.set(1001, {
        id: 1001,
        body: archiveBody({ requestId: 101 }),
        user: bot,
        issue_url: `https://api.github.com/repos/${repository}/issues/42`,
      });
      await expect(execute(g)).rejects.toThrow();
      expect(g.state.launches).toBe(0);
    }
  });

  test('invalid public archive pointers cannot erase history', async () => {
    for (const archive of [
      undefined,
      {},
      { commentId: 1, sha256: 'bad' },
      { commentId: -1, sha256: 'a'.repeat(64) },
    ]) {
      const f = withArchive();
      const claim = { ...parseVoiceClaim(f.state.comment!.body), archive };
      f.state.comment!.body =
        `${VOICE_BENCHMARK_MARKER}\n<!-- voice-benchmark-state ${JSON.stringify(claim)} -->`;
      await expect(execute(f)).rejects.toThrow();
      expect(f.state.launches).toBe(0);
    }
  });

  test('only an explicit dispatch opt-in reads the native run and attempt identities', () => {
    const environment = {
      VOICE_BENCHMARK_NEW_REQUEST: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_RUN_ID: '123456789',
      GITHUB_RUN_ATTEMPT: '2',
    };
    expect(readManualVoiceRequest(environment)).toEqual({
      runId: '123456789',
      runAttempt: '2',
    });
    expect(readManualVoiceRequest({})).toBeUndefined();
    expect(
      readManualVoiceRequest({
        ...environment,
        VOICE_BENCHMARK_NEW_REQUEST: 'false',
      }),
    ).toBeUndefined();
    for (const change of [
      { VOICE_BENCHMARK_NEW_REQUEST: '' },
      { VOICE_BENCHMARK_NEW_REQUEST: 'TRUE' },
      { GITHUB_EVENT_NAME: 'pull_request_target' },
      { GITHUB_EVENT_NAME: undefined },
      ...['', '0', '-1', '1.5', '01', '1e3', '1\n', '1'.repeat(21)].flatMap(
        (value) => [{ GITHUB_RUN_ID: value }, { GITHUB_RUN_ATTEMPT: value }],
      ),
    ])
      expect(() =>
        readManualVoiceRequest({ ...environment, ...change }),
      ).toThrow();
  });

  test('invalid manual identities fail before any GitHub or paid request', async () => {
    const f = fixture();
    await expect(
      execute(f, { ...manualOptions('invalid'), runIdentity }),
    ).rejects.toThrow('Invalid manual');
    await expect(
      execute(f, { ...manualOptions('123', '0'), runIdentity }),
    ).rejects.toThrow('Invalid manual');
    expect(f.calls).toHaveLength(0);
    expect(f.state.launches).toBe(0);
  });
});

describe('owned Docker cleanup', () => {
  test('revocation kills the owned process group, cleans containers and does not forward GitHub credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voice-owned-run-'));
    const abort = new AbortController();
    const cleanups: string[] = [];
    const logs: string[] = [];
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
        provenance,
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
        log: (line) => logs.push(line),
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
      expect(logs.join('\n')).toContain(
        '"category":"cancelled","signal":"SIGKILL"',
      );
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
