import { describe, expect, test } from 'bun:test';
import {
  currentPreviewWorkerNames,
  deletePreviewWorkers,
  discoverPreviewPrNumbers,
  legacyPreviewWorkerNames,
  previewWorkerNames,
} from './delete-preview-workers.ts';

const absentResponse = () =>
  Response.json(
    { success: false, errors: [{ code: 10090, message: 'Missing Worker' }] },
    { status: 404 },
  );

const dependencies = (
  fetch: typeof globalThis.fetch,
  errors: string[] = [],
  sleeps: number[] = [],
) => ({
  fetch,
  sleep: async (milliseconds: number) => {
    sleeps.push(milliseconds);
  },
  now: Date.now,
  log: () => {},
  error: (message: string) => errors.push(message),
});

describe('previewWorkerNames', () => {
  test('separates replaceable legacy names from current Alchemy names', () => {
    expect(legacyPreviewWorkerNames('42')).toEqual([
      'maelstrom-www-pr-42',
      'maelstrom-docs-pr-42',
      'maelstrom-playground-pr-42',
    ]);
    expect(currentPreviewWorkerNames('42')).toEqual([
      'maelstrom-www-alchemy-pr-42',
      'maelstrom-docs-alchemy-pr-42',
      'maelstrom-playground-alchemy-pr-42',
    ]);
    expect(previewWorkerNames('42')).toEqual([
      ...legacyPreviewWorkerNames('42'),
      ...currentPreviewWorkerNames('42'),
    ]);
    expect(() => previewWorkerNames('../production')).toThrow(
      'Invalid pull request number',
    );
  });
});

describe('deletePreviewWorkers', () => {
  for (const [workerScope, expectedNames] of [
    ['legacy', legacyPreviewWorkerNames('42')],
    ['current', currentPreviewWorkerNames('42')],
  ] as const) {
    test(`deletes only ${workerScope} Worker names when that scope is requested`, async () => {
      const requestedNames: string[] = [];
      const fetch = Object.assign(async (input: string | URL | Request) => {
        requestedNames.push(
          new URL(input.toString()).pathname.split('/').at(-1) ?? '',
        );
        return absentResponse();
      }, globalThis.fetch);

      await deletePreviewWorkers(
        {
          accountId: 'account',
          apiToken: 'secret',
          prNumber: '42',
          attempts: 1,
          workerScope,
        },
        dependencies(fetch),
      );

      expect(requestedNames).toEqual(expectedNames);
    });
  }

  test('repeats every deletion after success so a timed-out upload cannot become orphaned', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const sleeps: number[] = [];
    const fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: input.toString(), init });
        return absentResponse();
      },
      globalThis.fetch,
    );

    const success = await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
      },
      dependencies(fetch, [], sleeps),
    );

    expect(success).toBeTrue();
    expect(requests).toHaveLength(36);
    expect(sleeps).toEqual([60_000, 60_000, 60_000, 60_000, 60_000]);
    expect(
      requests.every(
        ({ url }) =>
          url.startsWith(
            'https://api.cloudflare.com/client/v4/accounts/account/workers/scripts/',
          ) && url.endsWith('?force=true'),
      ),
    ).toBeTrue();
    expect(
      requests.every(
        ({ init }) =>
          init?.method === 'DELETE' &&
          new Headers(init.headers).get('Authorization') === 'Bearer secret' &&
          init.signal instanceof AbortSignal,
      ),
    ).toBeTrue();
  });

  test('rechecks authorization before every direct deletion request', async () => {
    const authorized: string[] = [];
    const requested: string[] = [];
    const fetch = Object.assign(async (input: string | URL | Request) => {
      requested.push(
        new URL(input.toString()).pathname.split('/').at(-1) ?? '',
      );
      return absentResponse();
    }, globalThis.fetch);

    await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: 1,
        authorize: async (workerName) => {
          authorized.push(workerName);
          return !workerName.includes('-alchemy-');
        },
      },
      dependencies(fetch),
    );

    expect(authorized).toEqual(previewWorkerNames('42'));
    expect(requested).toEqual(legacyPreviewWorkerNames('42'));
  });

  test('recovers when transient API failures clear before the final pass', async () => {
    let request = 0;
    const fetch = Object.assign(async () => {
      request += 1;
      return request <= 12
        ? Response.json(
            { success: false, errors: [{ code: 9109, message: 'Forbidden' }] },
            { status: 403 },
          )
        : absentResponse();
    }, globalThis.fetch);

    const success = await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        retryDelayMs: 0,
      },
      dependencies(fetch),
    );

    expect(success).toBeTrue();
    expect(request).toBe(36);
  });

  test('honors Cloudflare retry-after before retrying a rate-limited deletion', async () => {
    let request = 0;
    const sleeps: number[] = [];
    const fetch = Object.assign(async () => {
      request += 1;
      return request <= 6
        ? Response.json(
            { success: false, errors: [{ code: 1015, message: 'Rate limit' }] },
            { status: 429, headers: { 'Retry-After': '300' } },
          )
        : absentResponse();
    }, globalThis.fetch);

    const success = await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: 2,
        retryDelayMs: 0,
      },
      dependencies(fetch, [], sleeps),
    );

    expect(success).toBeTrue();
    expect(sleeps).toEqual([300_000]);
  });

  test('defers reconciliation when retry-after exceeds the remaining budget', async () => {
    const sleeps: number[] = [];
    const fetch = Object.assign(
      async () =>
        Response.json(
          { success: false, errors: [{ code: 1015, message: 'Rate limit' }] },
          { status: 429, headers: { 'Retry-After': '300' } },
        ),
      globalThis.fetch,
    );

    const success = await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: 2,
        retryDelayMs: 0,
        totalBudgetMs: 100_000,
      },
      dependencies(fetch, [], sleeps),
    );

    expect(success).toBeFalse();
    expect(sleeps).toEqual([]);
  });

  test('honors retry-after on a temporary provider outage', async () => {
    let request = 0;
    const sleeps: number[] = [];
    const fetch = Object.assign(async () => {
      request += 1;
      return request <= 6
        ? Response.json(
            { success: false, errors: [{ code: 10000, message: 'Outage' }] },
            { status: 503, headers: { 'Retry-After': '120' } },
          )
        : absentResponse();
    }, globalThis.fetch);

    const success = await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: 2,
        retryDelayMs: 0,
      },
      dependencies(fetch, [], sleeps),
    );

    expect(success).toBeTrue();
    expect(sleeps).toEqual([120_000]);
  });

  test('validates credentials and bounded integer options before deletion', async () => {
    const fetch = Object.assign(async () => absentResponse(), globalThis.fetch);
    const invalidOptions = [
      { accountId: '', apiToken: 'secret', prNumber: '42' },
      { accountId: '../account', apiToken: 'secret', prNumber: '42' },
      { accountId: 'account', apiToken: ' ', prNumber: '42' },
      { accountId: 'account', apiToken: 'secret', prNumber: '42', attempts: 0 },
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: Number.NaN,
      },
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        retryDelayMs: -1,
      },
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        requestTimeoutMs: 0,
      },
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        totalBudgetMs: 0,
      },
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        concurrency: 7,
      },
    ];

    for (const options of invalidOptions) {
      expect(
        deletePreviewWorkers(options, dependencies(fetch)),
      ).rejects.toThrow();
    }
  });

  test('deletes each pass concurrently without exceeding its bound', async () => {
    let active = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    const fetch = Object.assign(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active -= 1;
      return absentResponse();
    }, globalThis.fetch);

    const result = deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: 1,
        concurrency: 3,
      },
      dependencies(fetch),
    );
    await Bun.sleep(0);
    expect(peak).toBe(3);
    while (pending.length > 0) pending.shift()?.();
    await Bun.sleep(0);
    while (pending.length > 0) pending.shift()?.();
    expect(await result).toBeTrue();
  });

  test('fails within the total budget instead of starting a late pass', async () => {
    let now = 0;
    let requests = 0;
    const fetch = Object.assign(async () => {
      requests += 1;
      now += 100;
      return Response.json(
        { success: false, errors: [{ code: 1015, message: 'Rate limit' }] },
        { status: 429, headers: { 'Retry-After': '300' } },
      );
    }, globalThis.fetch);
    const deps = {
      ...dependencies(fetch),
      now: () => now,
      sleep: async (milliseconds: number) => {
        now += milliseconds;
      },
    };

    const success = await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: 6,
        retryDelayMs: 60_000,
        totalBudgetMs: 61_000,
      },
      deps,
    );

    expect(success).toBeFalse();
    expect(now).toBeLessThanOrEqual(61_000);
    expect(requests).toBe(6);
  });

  test('fails closed when the final response contradicts its HTTP status', async () => {
    const errors: string[] = [];
    const fetch = Object.assign(
      async () =>
        Response.json({ success: false, errors: [] }, { status: 200 }),
      globalThis.fetch,
    );

    const success = await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: 1,
      },
      dependencies(fetch, errors),
    );

    expect(success).toBeFalse();
    expect(errors).toHaveLength(6);
  });

  test('does not hide an authorization failure beside a missing-worker error', async () => {
    const fetch = Object.assign(
      async () =>
        Response.json(
          {
            success: false,
            errors: [
              { code: 10090, message: 'Missing Worker' },
              { code: 9109, message: 'Forbidden' },
            ],
          },
          { status: 404 },
        ),
      globalThis.fetch,
    );

    const success = await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: 1,
      },
      dependencies(fetch),
    );

    expect(success).toBeFalse();
  });

  test('rejects a success envelope carrying provider errors', async () => {
    const fetch = Object.assign(
      async () =>
        Response.json({
          success: true,
          errors: [{ code: 9109, message: 'Contradictory error' }],
        }),
      globalThis.fetch,
    );

    await expect(
      deletePreviewWorkers(
        {
          accountId: 'account',
          apiToken: 'secret',
          prNumber: '42',
          attempts: 1,
        },
        dependencies(fetch),
      ),
    ).resolves.toBeFalse();
  });

  test('accepts Cloudflare success with or without an envelope', async () => {
    let request = 0;
    const fetch = Object.assign(async () => {
      request += 1;
      return request % 2 === 0
        ? Response.json({ success: true, errors: [] })
        : new Response(null, { status: 204 });
    }, globalThis.fetch);

    const success = await deletePreviewWorkers(
      {
        accountId: 'account',
        apiToken: 'secret',
        prNumber: '42',
        attempts: 1,
      },
      dependencies(fetch),
    );

    expect(success).toBeTrue();
  });
});

describe('discoverPreviewPrNumbers', () => {
  test('returns only PR numbers from exact current or legacy Worker names', async () => {
    const fetch = Object.assign(
      async () =>
        Response.json({
          success: true,
          errors: [],
          result: [
            { id: 'maelstrom-www-pr-42' },
            { id: 'maelstrom-docs-alchemy-pr-7' },
            { id: 'maelstrom-playground-alchemy-pr-42' },
            { id: 'maelstrom-www-pr-0' },
            { id: 'maelstrom-www-pr-42-extra' },
            { id: 'production' },
            { id: 42 },
          ],
        }),
      globalThis.fetch,
    );

    await expect(
      discoverPreviewPrNumbers(
        { accountId: 'account', apiToken: 'secret' },
        { fetch },
      ),
    ).resolves.toEqual(['7', '42']);
  });

  test('fails closed on credentials, HTTP errors, and malformed envelopes', async () => {
    const malformedFetch = Object.assign(
      async () => Response.json({ success: true, errors: [], result: {} }),
      globalThis.fetch,
    );
    await expect(
      discoverPreviewPrNumbers(
        { accountId: '', apiToken: 'secret' },
        { fetch: malformedFetch },
      ),
    ).rejects.toThrow();
    await expect(
      discoverPreviewPrNumbers(
        { accountId: 'account', apiToken: 'secret' },
        { fetch: malformedFetch },
      ),
    ).rejects.toThrow('invalid Worker list');

    const httpErrorFetch = Object.assign(
      async () =>
        Response.json(
          { success: true, errors: [], result: [] },
          { status: 500 },
        ),
      globalThis.fetch,
    );
    await expect(
      discoverPreviewPrNumbers(
        { accountId: 'account', apiToken: 'secret' },
        { fetch: httpErrorFetch },
      ),
    ).rejects.toThrow('HTTP 500');
  });

  test('rejects a reconciliation matrix above its safety limit', async () => {
    const fetch = Object.assign(
      async () =>
        Response.json({
          success: true,
          errors: [],
          result: Array.from({ length: 201 }, (_, index) => ({
            id: `maelstrom-www-pr-${index + 1}`,
          })),
        }),
      globalThis.fetch,
    );

    await expect(
      discoverPreviewPrNumbers(
        { accountId: 'account', apiToken: 'secret' },
        { fetch },
      ),
    ).rejects.toThrow('more than 200 candidates');
  });

  test('rejects Worker discovery success with provider errors', async () => {
    const fetch = Object.assign(
      async () =>
        Response.json({
          success: true,
          errors: [{ code: 9109, message: 'Contradictory error' }],
          result: [],
        }),
      globalThis.fetch,
    );

    await expect(
      discoverPreviewPrNumbers(
        { accountId: 'account', apiToken: 'secret' },
        { fetch },
      ),
    ).rejects.toThrow('invalid Worker list');
  });
});
