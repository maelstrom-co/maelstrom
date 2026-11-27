import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { CloudflareEnvironment } from '@alchemy.run/cloudflare';
import { Bucket, ProviderLive } from '@alchemy.run/cloudflare/R2';
import {
  apiTokenCredentials,
  Credentials,
} from '@distilled.cloud/cloudflare/Credentials';
import * as Provider from 'alchemy/Provider';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

async function simulateBucket(mode: 'race' | 'existing' | 'ordinary') {
  const bucket = 'maelstrom-blog-narration-preview';
  const accountId = 'a'.repeat(32);
  const input = {
    id: 'NarrationPreviewDelivery',
    fqn: 'NarrationPreviewDelivery',
    instanceId: 'candidate',
  };
  const apiToken = Redacted.make('offline-token');
  const requests: string[] = [];
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      requests.push(request.method);
      const prefix = `/client/v4/accounts/${accountId}/r2/buckets`;
      if (
        url.pathname !==
        (request.method === 'GET' ? `${prefix}/${bucket}` : prefix)
      ) {
        throw new Error(
          `Unexpected R2 request: ${request.method} ${url.pathname}`,
        );
      }
      if (request.method === 'GET' && mode !== 'race') {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            success: true,
            errors: [],
            messages: [],
            result: {
              name: bucket,
              jurisdiction: 'default',
              storageClass: 'Standard',
            },
          }),
        );
      }
      return HttpClientResponse.fromWeb(
        request,
        Response.json(
          {
            success: false,
            messages: [],
            errors: [
              {
                code: request.method === 'GET' ? 10006 : 10004,
                message:
                  request.method === 'GET'
                    ? 'Missing bucket'
                    : 'Competing create won',
              },
            ],
          },
          { status: request.method === 'GET' ? 404 : 409 },
        ),
      );
    }),
  );
  const services = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.succeed(Stage, 'shared-preview'),
    Layer.succeed(Stack, {
      name: 'NarrationFixture',
      stage: 'shared-preview',
      resources: {},
      bindings: {},
      actions: {},
    }),
    Layer.succeed(
      CloudflareEnvironment,
      Effect.succeed({
        type: 'apiToken' as const,
        accountId,
        apiToken,
        source: { type: 'env' as const },
      }),
    ),
    Layer.succeed(
      Credentials,
      Effect.succeed(apiTokenCredentials({ apiToken })),
    ),
  );
  const props = {
    name: bucket,
    ...(mode === 'ordinary' ? {} : { exclusiveCreate: true }),
  };
  let observed: string | undefined;
  const run = Effect.gen(function* () {
    const provider = yield* Provider.Provider<Bucket>(Bucket.Type);
    const found = yield* provider.read!({
      ...input,
      olds: props,
      output: undefined,
    });
    observed = found?.bucketName;
    if (mode === 'race') {
      yield* provider.reconcile({
        ...input,
        news: props,
        olds: undefined,
        output: undefined,
        bindings: [],
        session: {} as Parameters<typeof provider.reconcile>[0]['session'],
      });
    }
  }).pipe(
    Effect.provide(ProviderLive().pipe(Layer.provide(services))),
    Effect.provide(services),
  );
  const result = await Effect.runPromiseExit(run);
  return {
    requests,
    failed: Exit.isFailure(result),
    message: String(result),
    observed: observed ?? null,
  };
}

test('exclusive creation fails closed in both source and compiled R2 runtimes', async () => {
  const runtime = Bun.which('node');
  if (!runtime)
    throw new Error('Node is required to exercise the compiled R2 provider');
  const compiled = spawnSync(
    runtime,
    [
      '--input-type=module',
      '-e',
      `
    import { CloudflareEnvironment } from '@alchemy.run/cloudflare';
    import { Bucket, ProviderLive } from '@alchemy.run/cloudflare/R2';
    import { apiTokenCredentials, Credentials } from '@distilled.cloud/cloudflare/Credentials';
    import * as Provider from 'alchemy/Provider';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
    import * as Effect from 'effect/Effect';
    import * as Exit from 'effect/Exit';
    import * as HttpClient from 'effect/http/HttpClient';
    import * as HttpClientResponse from 'effect/http/HttpClientResponse';
    import * as Layer from 'effect/Layer';
    import * as Redacted from 'effect/Redacted';
    const simulate = ${simulateBucket.toString()};
    console.log(JSON.stringify(await Promise.all(['race', 'existing', 'ordinary'].map(simulate))));
  `,
    ],
    { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8', timeout: 20_000 },
  );
  expect(compiled.status, compiled.stderr).toBe(0);
  for (const [race, existing, ordinary] of [
    await Promise.all([
      simulateBucket('race'),
      simulateBucket('existing'),
      simulateBucket('ordinary'),
    ]),
    JSON.parse(compiled.stdout) as Awaited<ReturnType<typeof simulateBucket>>[],
  ]) {
    expect(race).toMatchObject({
      failed: true,
      requests: ['GET', 'POST'],
      observed: null,
    });
    expect(race.message).toContain('Competing create won');
    expect(existing).toMatchObject({
      failed: true,
      requests: ['GET'],
      observed: null,
    });
    expect(existing.message).toContain('no managed state');
    expect(ordinary).toMatchObject({
      failed: false,
      requests: ['GET'],
      observed: 'maelstrom-blog-narration-preview',
    });
  }
}, 30_000);
