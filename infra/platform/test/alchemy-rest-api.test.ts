import { describe, expect, test } from 'bun:test';
import {
  Credentials,
  fromAwsCredentialIdentity,
} from '@distilled.cloud/aws/Credentials';
import { BunServices } from '@effect/platform-bun';
import * as Apply from 'alchemy/Apply';
import { AWSEnvironment } from 'alchemy/AWS';
import { RestApi, RestApiProvider } from 'alchemy/AWS/ApiGateway';
import * as Plan from 'alchemy/Plan';
import * as Provider from 'alchemy/Provider';
import { Resource } from 'alchemy/Resource';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { inMemoryState, State } from 'alchemy/State';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';
import * as Layer from 'effect/Layer';

interface ProbeApi
  extends Resource<
    'AWS.ApiGateway.RestApi',
    RestApi['Props'],
    RestApi['Attributes'],
    RestApi['Binding']
  > {}
const ProbeApi = Resource<ProbeApi>('AWS.ApiGateway.RestApi');

async function reconcile(options: {
  recorded: boolean;
  missing?: boolean;
  retry?: boolean;
  recover?: 'owned' | 'foreign' | 'partial' | 'ambiguous' | 'older';
}) {
  const requests: { method: string; path: string }[] = [];
  let creates = 0;
  let failedRead = false;
  let firstAttempt: Exit.Exit<unknown, unknown> | undefined;
  let checkpoint: { status: string; attr?: unknown } | undefined;
  const tags = {
    'alchemy::stack': 'ApiProbe',
    'alchemy::stage': 'probe',
    'alchemy::id': 'Api',
    'alchemy::instance': 'probe-instance',
  };
  const snapshot = {
    id: 'api-id',
    rootResourceId: 'root-id',
    name: 'Probe',
    tags,
  };
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      requests.push({ method: request.method, path: url.pathname });
      let response: Response;
      if (request.method === 'GET' && url.pathname === '/restapis') {
        const foreign = {
          ...snapshot,
          id: 'foreign-api',
          tags: { ...tags, 'alchemy::stack': 'Other' },
        };
        const candidates =
          options.recover === 'ambiguous'
            ? [snapshot, { ...snapshot, id: 'duplicate-api' }]
            : options.recover === 'foreign'
              ? [foreign]
              : options.recover === 'older'
                ? [
                    {
                      ...snapshot,
                      tags: { ...tags, 'alchemy::instance': 'old-generation' },
                    },
                  ]
                : options.recover === 'partial'
                  ? [{ ...snapshot, tags: { 'alchemy::stack': 'ApiProbe' } }]
                  : options.recover === 'owned' || creates > 0
                    ? [snapshot]
                    : [];
        response = url.searchParams.has('position')
          ? Response.json({ item: candidates })
          : Response.json({ item: [foreign], position: 'next-page' });
      } else if (
        request.method === 'GET' &&
        url.pathname === '/restapis/api-id'
      ) {
        const interrupt = options.retry && creates > 0 && !failedRead;
        if (interrupt) failedRead = true;
        response =
          options.missing || interrupt
            ? Response.json(
                { message: 'API not found' },
                {
                  status: 404,
                  headers: { 'x-amzn-ErrorType': 'NotFoundException' },
                },
              )
            : Response.json(snapshot);
      } else if (
        !options.recorded &&
        request.method === 'POST' &&
        url.pathname === '/restapis'
      ) {
        creates++;
        const body =
          request.body._tag === 'Uint8Array'
            ? new TextDecoder().decode(request.body.body)
            : request.body._tag === 'Raw' &&
                typeof request.body.body === 'string'
              ? request.body.body
              : undefined;
        if (!body) throw new Error('Expected a JSON API creation request');
        snapshot.tags = JSON.parse(body).tags;
        response = Response.json(snapshot);
      } else {
        throw new Error(
          `Unexpected API Gateway request: ${request.method} ${url.pathname}`,
        );
      }
      return HttpClientResponse.fromWeb(request, response);
    }),
  );
  const credentials = Effect.succeed(
    fromAwsCredentialIdentity(
      {
        accessKeyId: 'offline-test-key',
        secretAccessKey: 'offline-test-secret',
      },
      'us-east-1',
    ),
  );
  const services = Layer.mergeAll(
    BunServices.layer,
    inMemoryState(),
    Layer.succeed(Credentials, credentials),
    Layer.succeed(
      AWSEnvironment,
      Effect.succeed({
        accountId: '000000000000',
        region: 'us-east-1',
        credentials,
      }),
    ),
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.succeed(Stack, {
      name: 'ApiProbe',
      stage: 'probe',
      resources: {},
      bindings: {},
      actions: {},
    }),
    Layer.succeed(Stage, 'probe'),
  );
  const program = Effect.gen(function* () {
    const provider = yield* Provider.Provider<RestApi>(RestApi.Type);
    if (options.recover) {
      if (!provider.read)
        return yield* Effect.die('RestApi must have a recovery reader');
      return yield* provider.read({
        id: 'Api',
        fqn: 'Api',
        instanceId: 'probe-instance',
        olds: { name: 'Probe' },
        output: undefined,
      });
    }
    if (options.retry) {
      const api = yield* ProbeApi('Api', { name: 'Probe' });
      const stack = yield* Stack;
      const context = yield* Effect.context<
        Provider.Provider<ProbeApi> | State | Stack | Stage
      >();
      const compiled = { ...stack, output: api, services: context };
      firstAttempt = yield* Effect.exit(
        Apply.apply(yield* Plan.make(compiled)),
      );
      const store = yield* yield* State;
      checkpoint = yield* store.get({
        stack: stack.name,
        stage: stack.stage,
        fqn: 'Api',
      });
      return yield* Apply.apply(yield* Plan.make(compiled));
    }
    return yield* provider.reconcile({
      id: 'Api',
      fqn: 'Api',
      instanceId: 'probe-instance',
      news: { name: 'Probe' },
      olds: undefined,
      bindings: [],
      output: options.recorded
        ? {
            restApiId: 'api-id',
            rootResourceId: 'root-id',
            name: 'Probe',
            tags,
            description: undefined,
            version: undefined,
            binaryMediaTypes: undefined,
            minimumCompressionSize: undefined,
            apiKeySource: undefined,
            endpointConfiguration: undefined,
            policy: undefined,
            disableExecuteApiEndpoint: undefined,
            securityPolicy: undefined,
            endpointAccessMode: undefined,
          }
        : undefined,
      session: {
        note: () => Effect.void,
        emit: () => Effect.void,
        done: () => Effect.void,
      },
    });
  });
  const exit = await Effect.runPromise(
    program.pipe(
      Effect.exit,
      Effect.provide(
        Layer.mergeAll(
          RestApiProvider().pipe(Layer.provide(services)),
          Provider.effect(
            ProbeApi,
            Provider.Provider<RestApi>(RestApi.Type).pipe(
              Effect.map((provider) => ({
                list: provider.list,
                read: provider.read,
                diff: provider.diff,
                precreate: provider.precreate,
                reconcile: provider.reconcile,
                delete: provider.delete,
                stables: provider.stables,
              })),
            ),
          ).pipe(
            Layer.provide(RestApiProvider().pipe(Layer.provide(services))),
          ),
        ),
      ),
      Effect.provide(services),
      Effect.scoped,
    ),
  );
  return { exit, requests, creates, firstAttempt, checkpoint };
}

describe('REST API compatibility with cycle-only precreation', () => {
  test('recovers an accepted API creation after a later read fails instead of creating a duplicate', async () => {
    const result = await reconcile({ recorded: false, retry: true });
    expect(result.firstAttempt?._tag).toBe('Failure');
    expect(result.checkpoint).toMatchObject({ status: 'creating' });
    expect(result.checkpoint?.attr).toBeUndefined();
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.creates).toBe(1);
  });

  test('finds a uniquely owned API beyond the first page', async () => {
    const result = await reconcile({ recorded: false, recover: 'owned' });
    expect(result.exit).toMatchObject({
      _tag: 'Success',
      value: { restApiId: 'api-id' },
    });
    expect(result.creates).toBe(0);
    expect(
      result.requests.filter((request) => request.path === '/restapis'),
    ).toHaveLength(2);
  });

  test.each([
    'foreign',
    'partial',
    'older',
  ] as const)('does not recover an API with %s ownership or generation tags', async (recover) => {
    const result = await reconcile({ recorded: false, recover });
    expect(result.exit).toMatchObject({ _tag: 'Success', value: undefined });
    expect(result.creates).toBe(0);
  });

  test('refuses ambiguous owned APIs before any mutation', async () => {
    const result = await reconcile({ recorded: false, recover: 'ambiguous' });
    expect(Exit.isFailure(result.exit)).toBe(true);
    expect(result.creates).toBe(0);
    expect(result.requests.every((request) => request.method === 'GET')).toBe(
      true,
    );
  });
  test('creates an API when no physical identity was precreated', async () => {
    const result = await reconcile({ recorded: false });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    if (Exit.isSuccess(result.exit))
      expect(result.exit.value).toMatchObject({
        restApiId: 'api-id',
        rootResourceId: 'root-id',
      });
    expect(result.requests).toEqual([
      { method: 'GET', path: '/restapis' },
      { method: 'GET', path: '/restapis' },
      { method: 'POST', path: '/restapis' },
      { method: 'GET', path: '/restapis/api-id' },
      { method: 'GET', path: '/restapis/api-id' },
    ]);
  });

  test('preserves a recorded API identity rather than creating another one', async () => {
    const result = await reconcile({ recorded: true });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.requests).toEqual([
      { method: 'GET', path: '/restapis/api-id' },
      { method: 'GET', path: '/restapis/api-id' },
    ]);
  });

  test('fails instead of silently replacing stable IDs when a recorded API disappears', async () => {
    const result = await reconcile({ recorded: true, missing: true });
    expect(Exit.isFailure(result.exit)).toBe(true);
    if (Exit.isFailure(result.exit))
      expect(result.exit.cause.reasons.find(Cause.isDieReason)?.defect).toBe(
        'RestApi api-id disappeared between precreate and reconcile',
      );
    expect(result.requests).toEqual([
      { method: 'GET', path: '/restapis/api-id' },
    ]);
  });
});
