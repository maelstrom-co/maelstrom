import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { CloudflareEnvironment, Providers } from '@alchemy.run/cloudflare';
import { Ruleset, RulesetProvider } from '@alchemy.run/cloudflare/Ruleset';
import { Zone } from '@alchemy.run/cloudflare/Zone';
import {
  apiTokenCredentials,
  Credentials,
} from '@distilled.cloud/cloudflare/Credentials';
import { BunServices } from '@effect/platform-bun';
import { AdoptPolicy } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Apply from 'alchemy/Apply';
import * as Plan from 'alchemy/Plan';
import * as Provider from 'alchemy/Provider';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { inMemoryState, State } from 'alchemy/State';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

const phase = 'http_ratelimit';
const props = {
  zone: { zoneId: 'zone-id', paused: false },
  phase,
  name: 'Limit',
  rules: [],
};
const attributes = {
  zoneId: 'zone-id',
  phase,
  rulesetId: 'ruleset-id',
  name: 'Limit',
  kind: 'zone',
  description: undefined,
  rules: [],
  lastUpdated: '2026-01-01T00:00:00Z',
  version: '1',
};
const environment = Layer.succeed(
  CloudflareEnvironment,
  Effect.succeed({
    type: 'apiToken' as const,
    accountId: 'a'.repeat(32),
    apiToken: Redacted.make('offline-token'),
    source: { type: 'env' as const },
  }),
);
const credentials = Layer.succeed(
  Credentials,
  Effect.succeed(
    apiTokenCredentials({ apiToken: Redacted.make('offline-token') }),
  ),
);
const diffServices = Layer.mergeAll(
  environment,
  credentials,
  Layer.succeed(Stack, {
    name: 'RulesetProbe',
    stage: 'probe',
    resources: {},
    bindings: {},
    actions: {},
  }),
  Layer.succeed(Stage, 'probe'),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die('A diff must not call Cloudflare')),
  ),
);
type DiffInput = Parameters<
  NonNullable<Provider.ProviderService<Ruleset>['diff']>
>[0];
const input = (changes: Record<string, unknown> = {}) =>
  ({
    id: 'RateLimit',
    fqn: 'RateLimit',
    instanceId: 'saved-ruleset',
    olds: props,
    news: { ...props, zone: { zoneId: 'zone-id', paused: true } },
    output: attributes,
    ...changes,
  }) as unknown as DiffInput;
const cases = [
  {
    name: 'a Zone metadata change keeps the recorded Ruleset identity',
    changes: {},
    action: 'noop',
  },
  {
    name: 'an explicit name change remains mutable',
    changes: { news: { ...props, name: 'Changed' } },
    action: 'update',
  },
  {
    name: 'a description change remains mutable',
    changes: { news: { ...props, description: 'Changed' } },
    action: 'update',
  },
  {
    name: 'rule changes remain mutable',
    changes: {
      news: { ...props, rules: [{ action: 'block', expression: 'true' }] },
    },
    action: 'update',
  },
  {
    name: 'a different zone requires replacement',
    changes: { news: { ...props, zone: { zoneId: 'other-zone' } } },
    action: 'replace',
  },
  {
    name: 'a different phase requires replacement',
    changes: { news: { ...props, phase: 'http_request_firewall_custom' } },
    action: 'replace',
  },
  {
    name: 'conflicting recorded zone identity requires replacement',
    changes: { output: { ...attributes, zoneId: 'other-zone' } },
    action: 'replace',
  },
  {
    name: 'missing recorded attributes do not prove identity',
    changes: { output: undefined },
    action: undefined,
  },
  {
    name: 'missing recorded zone identity stays inconclusive',
    changes: { output: { ...attributes, zoneId: undefined } },
    action: undefined,
  },
  {
    name: 'missing recorded phase stays inconclusive',
    changes: { output: { ...attributes, phase: undefined } },
    action: undefined,
  },
  {
    name: 'conflicting recorded phase stays inconclusive',
    changes: {
      output: { ...attributes, phase: 'http_request_firewall_custom' },
    },
    action: undefined,
  },
  {
    name: 'empty zone identifiers do not prove identity',
    changes: {
      olds: { ...props, zone: { zoneId: '' } },
      news: { ...props, zone: { zoneId: '' } },
      output: { ...attributes, zoneId: '' },
    },
    action: undefined,
  },
  {
    name: 'an absent desired zone stays inconclusive',
    changes: { news: { ...props, zone: undefined } },
    action: undefined,
  },
  {
    name: 'an unresolved desired zone stays inconclusive',
    changes: {
      news: { ...props, zone: { zoneId: Effect.succeed('zone-id') } },
    },
    action: undefined,
  },
] as const;

for (const item of cases) {
  test(item.name, async () => {
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Provider.Provider<Ruleset>(Ruleset.Type);
        return yield* provider.diff!(input(item.changes));
      }).pipe(
        Effect.provide(RulesetProvider().pipe(Layer.provide(diffServices))),
        Effect.provide(diffServices),
      ),
    );
    expect(decision?.action).toBe(item.action);
  });
}

test('the compiled provider preserves concrete, unknown, mutable, and replaced identities', () => {
  const script = `
import { Ruleset, RulesetProvider } from '@alchemy.run/cloudflare/Ruleset';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
const props = ${JSON.stringify(props)};
const output = ${JSON.stringify(attributes)};
const news = [{ ...props, zone: { ...props.zone, paused: true } }, props, { ...props, name: 'Changed' }, { ...props, zone: { zoneId: 'other-zone' } }];
const results = await Effect.runPromise(Effect.gen(function* () {
  const provider = yield* Provider.Provider(Ruleset.Type);
  const decisions = [];
  for (let index = 0; index < news.length; index++) {
    decisions.push(yield* provider.diff({ id: 'RateLimit', fqn: 'RateLimit', instanceId: 'saved-ruleset', olds: props, news: news[index], output: index === 1 ? undefined : output }));
  }
  return decisions;
}).pipe(Effect.provide(RulesetProvider())));
console.log(JSON.stringify(results));
`;
  const result = spawnSync('node', ['--input-type=module', '--eval', script], {
    cwd: resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(result.stderr);
  expect(JSON.parse(result.stdout)).toEqual([
    { action: 'noop' },
    null,
    { action: 'update' },
    { action: 'replace' },
  ]);
});

test('applying a Zone metadata update preserves its dependent Ruleset generation', async () => {
  const requests: Array<{ method: string; path: string }> = [];
  let zoneWrites = 0;
  let deleted = false;
  const stack = {
    name: 'RulesetProbe',
    stage: 'probe',
    resources: {},
    bindings: {},
    actions: {},
  };
  const oldZone = {
    zoneId: 'zone-id',
    name: 'example.com',
    paused: false,
  } as Zone['Attributes'];
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      requests.push({ method: request.method, path: url.pathname });
      if (
        !['GET', 'PUT'].includes(request.method) ||
        url.pathname !==
          '/client/v4/zones/zone-id/rulesets/phases/http_ratelimit/entrypoint'
      ) {
        throw new Error(
          `Unexpected Ruleset request: ${request.method} ${url.pathname}`,
        );
      }
      return HttpClientResponse.fromWeb(
        request,
        Response.json({
          success: true,
          errors: [],
          messages: [],
          result: {
            id: 'ruleset-id',
            kind: 'zone',
            name: 'Limit',
            phase,
            rules: [],
            last_updated: '2026-01-01T00:00:00Z',
            version: '1',
          },
        }),
      );
    }),
  );
  const services = Layer.mergeAll(
    BunServices.layer,
    inMemoryState(),
    Layer.succeed(Stack, stack),
    Layer.succeed(Stage, 'probe'),
    credentials,
    environment,
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.succeed(AdoptPolicy, false),
    Layer.succeed(AlchemyContext, {
      dotAlchemy: '.alchemy',
      dev: false,
      adopt: false,
    }),
  );
  const zoneProvider = Provider.succeed(Zone, {
    stables: ['zoneId'],
    diff: () => Effect.succeed({ action: 'update' as const }),
    reconcile: ({ news }) =>
      Effect.sync(() => {
        zoneWrites++;
        return { ...oldZone, paused: news.paused ?? false };
      }),
    delete: () =>
      Effect.sync(() => {
        deleted = true;
      }),
  });
  const providerLayers = Layer.mergeAll(
    zoneProvider,
    RulesetProvider().pipe(Layer.provide(services)),
  );
  const collection = Layer.effect(
    Providers,
    Provider.collection([Zone, Ruleset]),
  ).pipe(Layer.provide(providerLayers));
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const zone = yield* Zone('Zone', { name: 'example.com', paused: true });
      const ruleset = yield* Ruleset('RateLimit', {
        zone,
        name: 'Limit',
        phase,
        rules: [],
      });
      const context = yield* Effect.context<
        | Provider.Provider<Zone>
        | Provider.Provider<Ruleset>
        | State
        | Stack
        | Stage
        | Providers
      >();
      const compiled = { ...stack, output: ruleset, services: context };
      const store = yield* yield* State;
      const base = {
        stack: stack.name,
        stage: stack.stage,
        providerVersion: 0,
        namespace: undefined,
        bindings: [],
        downstream: [],
      };
      yield* store.set({
        stack: stack.name,
        stage: stack.stage,
        fqn: 'Zone',
        value: {
          ...base,
          status: 'created',
          fqn: 'Zone',
          logicalId: 'Zone',
          instanceId: 'saved-zone',
          resourceType: Zone.Type,
          props: { name: 'example.com', paused: false },
          attr: oldZone,
        },
      });
      yield* store.set({
        stack: stack.name,
        stage: stack.stage,
        fqn: 'RateLimit',
        value: {
          ...base,
          status: 'created',
          fqn: 'RateLimit',
          logicalId: 'RateLimit',
          instanceId: 'saved-ruleset',
          resourceType: Ruleset.Type,
          props: { ...props, zone: oldZone },
          attr: attributes,
        },
      });
      const exit = yield* Effect.exit(Apply.apply(yield* Plan.make(compiled)));
      const checkpoint = yield* store.get({
        stack: stack.name,
        stage: stack.stage,
        fqn: 'RateLimit',
      });
      return { exit, checkpoint };
    }).pipe(
      Effect.provide(Layer.mergeAll(providerLayers, collection)),
      Effect.provide(services),
      Effect.scoped,
    ),
  );
  if (Exit.isFailure(result.exit))
    throw new Error(JSON.stringify(result.exit.cause));
  expect(zoneWrites).toBe(1);
  expect(result.checkpoint).toMatchObject({
    status: 'created',
    instanceId: 'saved-ruleset',
    attr: { zoneId: 'zone-id', rulesetId: 'ruleset-id', phase },
  });
  expect(deleted).toBeFalse();
  expect(requests).toEqual([]);
});
