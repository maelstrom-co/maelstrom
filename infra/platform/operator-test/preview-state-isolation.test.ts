import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';

import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';

import {
  makePreviewIsolationRuntime,
  previewWirePort,
  previewWireReader,
} from '../preview-state-isolation.ts';
import { OSS_PREVIEW_STATE_STORE_WORKER } from '../src/PreviewStateStoreContract.js';

const previousHome = process.env.ALCHEMY_HOME;
let isolatedHome: string;
beforeAll(async () => {
  isolatedHome = await mkdtemp('/tmp/alchemy-isolation-test-');
  process.env.ALCHEMY_HOME = isolatedHome;
});
afterAll(async () => {
  if (previousHome === undefined) delete process.env.ALCHEMY_HOME;
  else process.env.ALCHEMY_HOME = previousHome;
  await rm(isolatedHome, { recursive: true, force: true });
});
const config = {
  accountId: 'a'.repeat(32),
  apiToken: 'offline-token',
  workersDevSuffix: 'fixture.workers.dev',
};
const source = 'https://alchemy-state-store.fixture.workers.dev';
const target = `https://${OSS_PREVIEW_STATE_STORE_WORKER}.fixture.workers.dev`;
const scope = { stack: 'MaelstromDemoPreview', stage: 'pr-42' };

test('the real SDK wire client preserves encoded secrets, old chains, outputs and escaped FQNs', async () => {
  const row = {
    attr: { workerName: 'owned' },
    old: { instanceId: 'old' },
    secret: { __redacted__: { sensitive: 'opaque' } },
    duration: { __duration__: 42 },
    date: { __date__: '2026-01-01' },
    unknown: { kept: true },
  };
  const writes: Array<{ url: string; value: unknown }> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = request.url;
      if (request.method === 'PUT') {
        if (request.body._tag !== 'Uint8Array')
          throw new Error('expected encoded JSON');
        writes.push({
          url,
          value: JSON.parse(new TextDecoder().decode(request.body.body)),
        });
        return HttpClientResponse.fromWeb(
          request,
          Response.json(writes.at(-1)!.value),
        );
      }
      const result = url.endsWith('/version')
        ? { version: 7 }
        : url.endsWith('/output')
          ? null
          : row;
      return HttpClientResponse.fromWeb(request, Response.json(result));
    }),
  );
  const runtime = makePreviewIsolationRuntime(config, client);
  runtime.destinationScopes.add(`${scope.stack}/${scope.stage}`);
  try {
    const reader = await previewWirePort(
      runtime,
      config,
      'alchemy-state-store',
      source,
      'state-token',
    );
    const writer = await previewWirePort(
      runtime,
      config,
      OSS_PREVIEW_STATE_STORE_WORKER,
      target,
      'new-token',
    );
    const key = { ...scope, fqn: 'Folder/Website' };
    expect(await reader.version()).toBe(7);
    expect(await reader.get(key)).toEqual(row);
    expect(await reader.output(scope)).toBeNull();
    await writer.put(key, row);
    await writer.putOutput(scope, null);
    expect(writes).toEqual([
      {
        url:
          target +
          '/state/stacks/MaelstromDemoPreview/stages/pr-42/resources/Folder%252FWebsite',
        value: row,
      },
      {
        url: target + '/state/stacks/MaelstromDemoPreview/stages/pr-42/output',
        value: null,
      },
    ]);
  } finally {
    await runtime.dispose();
  }
});

test('the runtime rejects source mutations, undeclared target outputs and default Worker uploads before transport', async () => {
  const sent: string[] = [];
  const runtime = makePreviewIsolationRuntime(
    config,
    HttpClient.make((request) =>
      Effect.sync(() => {
        sent.push(request.url);
        return HttpClientResponse.fromWeb(
          request,
          new Response(null, { status: 204 }),
        );
      }),
    ),
  );
  try {
    for (const request of [
      HttpClientRequest.put(
        source + '/state/stacks/MaelstromDemoPreview/stages/pr-42/output',
      ),
      HttpClientRequest.put(
        target + '/state/stacks/MaelstromDemoPreview/stages/pr-9999/output',
      ),
      HttpClientRequest.put(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/scripts/alchemy-state-store`,
      ),
      HttpClientRequest.delete(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/secrets_store/stores/store/secrets/default-key`,
      ),
    ])
      await expect(
        runtime.run(
          Effect.flatMap(HttpClient.HttpClient, (c) => c.execute(request)),
          'ISOLATION_BLOCKED',
        ),
      ).rejects.toThrow('ISOLATION_BLOCKED');
    expect(sent).toEqual([]);
    await expect(
      previewWirePort(runtime, config, 'alchemy-state-store', target, 'secret'),
    ).rejects.toThrow('IDENTITY_REJECTED');
  } finally {
    await runtime.dispose();
  }
});

test('valid state JSON succeeds below the response limit and fails above it', async () => {
  for (const size of [1024, 16 * 1024 * 1024 + 1]) {
    const value = { payload: 'x'.repeat(size) };
    const runtime = makePreviewIsolationRuntime(
      config,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(request, Response.json(value)),
        ),
      ),
    );
    try {
      const reader = await previewWirePort(
        runtime,
        config,
        'alchemy-state-store',
        source,
        'state-token',
      );
      const read = reader.get({ ...scope, fqn: 'Website' });
      if (size === 1024) expect(await read).toEqual(value);
      else await expect(read).rejects.toThrow('ISOLATION_RESOURCE_READ_FAILED');
    } finally {
      await runtime.dispose();
    }
  }
});

test('library logs and Interaction errors cannot disclose an SDK secret-probe body', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--eval',
      `
    import * as Effect from 'effect/Effect';
    import * as Interaction from 'alchemy/Interaction';
    import {makePreviewIsolationRuntime} from './preview-state-isolation.ts';
    const r=makePreviewIsolationRuntime(${JSON.stringify(config)});
    try { await r.run(Effect.gen(function*(){ yield* Effect.logError('secret-sentinel'); const i=yield* Interaction.Interaction; yield* i.output.error('secret-sentinel'); return yield* Effect.fail(new Error('secret-sentinel')); }),'ISOLATION_FIXED'); }
    catch(e){ console.error(e.message); }
    finally{await r.dispose();}
  `,
    ],
    {
      cwd: import.meta.dir + '/..',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { PATH: process.env.PATH, CI: 'true', ALCHEMY_HOME: isolatedHome },
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  expect(out + err).not.toContain('secret-sentinel');
  expect(err).toContain('ISOLATION_FIXED');
});

test('absent outputs remain absent while persisted null and no-content cleanup retain their wire meaning', async () => {
  const runtime = makePreviewIsolationRuntime(
    config,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          request.method === 'DELETE'
            ? new Response(null, { status: 204 })
            : request.url.includes('pr-42')
              ? new Response(null, { status: 200 })
              : Response.json(null),
        ),
      ),
    ),
  );
  try {
    const reader = await previewWirePort(
      runtime,
      config,
      'alchemy-state-store',
      source,
      'state-token',
    );
    expect(await reader.output(scope)).toBeUndefined();
    expect(await reader.output({ ...scope, stage: 'pr-43' })).toBeNull();
    const deleted = await runtime.run(
      Effect.flatMap(HttpClient.HttpClient, (c) =>
        c.execute(
          HttpClientRequest.delete(
            target + '/state/stacks/CloudflareStateStore',
          ),
        ),
      ),
      'ISOLATION_DELETE_FAILED',
    );
    expect(deleted.status).toBe(204);
  } finally {
    await runtime.dispose();
  }
});

test('source credential discovery sends only a temporary preview POST and preserves the deployed store', async () => {
  const sent: { method: string; path: string }[] = [];
  const runtime = makePreviewIsolationRuntime(
    config,
    HttpClient.make((request) =>
      Effect.sync(() => {
        const url = new URL(request.url);
        sent.push({ method: request.method, path: url.pathname });
        const reply = (result: unknown) =>
          HttpClientResponse.fromWeb(
            request,
            Response.json({ success: true, errors: [], messages: [], result }),
          );
        if (url.hostname === 'exchange.fixture.invalid')
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ token: 'upload-token' }),
          );
        if (url.hostname === 'alchemy-state-store.fixture.workers.dev')
          return HttpClientResponse.fromWeb(
            request,
            url.pathname === '/version'
              ? Response.json({ version: 7 })
              : new Response('source-token'),
          );
        if (url.pathname.endsWith('/workers/subdomain/edge-preview'))
          return reply({
            token: 'session-token',
            exchange_url: 'https://exchange.fixture.invalid/session',
          });
        if (url.pathname.endsWith('/workers/subdomain'))
          return reply({ subdomain: 'fixture' });
        if (url.pathname.endsWith('/secrets_store/stores'))
          return reply([
            {
              id: 'store-id',
              name: 'fixture',
              created: '2026-01-01T00:00:00Z',
              modified: '2026-01-01T00:00:00Z',
            },
          ]);
        if (
          url.pathname.endsWith(
            '/workers/scripts/alchemy-state-store/edge-preview',
          )
        )
          return reply({ preview_token: 'preview-token' });
        throw new Error('unexpected offline request');
      }),
    ),
  );
  try {
    const reader = await previewWireReader(
      runtime,
      config,
      'alchemy-state-store',
    );
    expect(await reader.version()).toBe(7);
    expect(sent.filter((r) => r.method !== 'GET')).toEqual([
      {
        method: 'POST',
        path: `/client/v4/accounts/${config.accountId}/workers/scripts/alchemy-state-store/edge-preview`,
      },
    ]);
    expect(sent.some((r) => r.path === '/session')).toBeTrue();
  } finally {
    await runtime.dispose();
  }
});
