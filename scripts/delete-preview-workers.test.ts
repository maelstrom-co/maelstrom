import { describe, expect, test } from 'bun:test';
import {
  deletePreviewWorkers,
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
  log: () => {},
  error: (message: string) => errors.push(message),
});

describe('previewWorkerNames', () => {
  test('limits forced deletion to the six known names for one PR', () => {
    expect(previewWorkerNames('42')).toEqual([
      'maelstrom-www-pr-42',
      'maelstrom-www-alchemy-pr-42',
      'maelstrom-docs-pr-42',
      'maelstrom-docs-alchemy-pr-42',
      'maelstrom-playground-pr-42',
      'maelstrom-playground-alchemy-pr-42',
    ]);
    expect(() => previewWorkerNames('../production')).toThrow(
      'Invalid pull request number',
    );
  });
});

describe('deletePreviewWorkers', () => {
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
