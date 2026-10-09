import { describe, expect, test } from 'bun:test';
import {
  apiTokenCredentials,
  Credentials,
} from '@distilled.cloud/cloudflare/Credentials';
import { BunServices } from '@effect/platform-bun';
import { AdoptPolicy } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Apply from 'alchemy/Apply';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Plan from 'alchemy/Plan';
import * as Provider from 'alchemy/Provider';
import { Resource } from 'alchemy/Resource';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { encodeState, inMemoryState, reviveState, State } from 'alchemy/State';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

const accountId = '00000000000000000000000000000000';
const ownerTags = [
  'alchemy:stack:OwnershipProbe',
  'alchemy:stage:probe',
  'alchemy:id:Website',
];
interface ProbeWorker
  extends Resource<
    'Cloudflare.Worker',
    Cloudflare.Worker['Props'],
    Cloudflare.Worker['Attributes'],
    Cloudflare.Worker['Binding']
  > {}
const Worker = Resource<ProbeWorker>(Cloudflare.Worker.Type);
interface Binding
  extends Resource<
    'Probe.Binding',
    Record<string, never>,
    { id: string },
    { worker: string }
  > {}
const Binding = Resource<Binding>('Probe.Binding');

interface FixtureOptions {
  adopt?: boolean;
  noVersions?: boolean;
  namespace?: string;
  normalOwned?: boolean;
  dispatchOwned?: boolean;
  healthyExisting?: boolean;
}

function fixture(tags: readonly string[], options: FixtureOptions = {}) {
  const requests: { method: string; path: string }[] = [];
  const bindingWrites: unknown[] = [];
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      requests.push({ method: request.method, path: url.pathname });
      if (request.method !== 'GET')
        throw new Error('The ownership probe must not mutate Cloudflare');
      let response: Response;
      if (url.pathname.endsWith('/settings')) {
        response = options.noVersions
          ? Response.json(
              {
                success: false,
                errors: [{ code: 10000, message: 'Worker has no versions' }],
                messages: [],
              },
              { status: 404 },
            )
          : Response.json({
              success: true,
              errors: [],
              messages: [],
              result: {
                tags:
                  (options.normalOwned &&
                    !url.pathname.includes('/dispatch/')) ||
                  (options.dispatchOwned && url.pathname.includes('/dispatch/'))
                    ? ownerTags
                    : tags,
                bindings: [],
              },
            });
      } else if (url.pathname.endsWith('/scripts')) {
        response = Response.json({
          success: true,
          errors: [],
          messages: [],
          result: [{ id: 'existing-worker', tag: 'immutable-id' }],
        });
      } else if (
        url.pathname.includes('/dispatch/') &&
        url.pathname.endsWith('/scripts/existing-worker')
      ) {
        response = Response.json({
          success: true,
          errors: [],
          messages: [],
          result: { script: { tag: 'immutable-id' } },
        });
      } else if (url.pathname.endsWith('/subdomain')) {
        response =
          options.normalOwned || options.healthyExisting
            ? Response.json({
                success: true,
                errors: [],
                messages: [],
                result: { enabled: false },
              })
            : Response.json(
                {
                  success: false,
                  errors: [{ code: 10007, message: 'Worker not found' }],
                  messages: [],
                },
                { status: 404 },
              );
      } else {
        throw new Error(`Unexpected Cloudflare request: ${url.pathname}`);
      }
      return HttpClientResponse.fromWeb(request, response);
    }),
  );
  const services = Layer.mergeAll(
    BunServices.layer,
    inMemoryState(),
    Provider.succeed(Binding, {
      list: () => Effect.succeed([]),
      precreate: () => Effect.succeed({ id: 'binding-id' }),
      reconcile: ({ bindings }) =>
        Effect.sync(() => {
          bindingWrites.push(bindings);
          return { id: 'binding-id' };
        }),
      delete: () => Effect.void,
    }),
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.succeed(
      Credentials,
      Effect.succeed(
        apiTokenCredentials({
          apiToken: 'offline-test-token',
          apiBaseUrl: 'https://cloudflare.invalid/client/v4',
        }),
      ),
    ),
    Layer.succeed(
      Cloudflare.CloudflareEnvironment,
      Effect.succeed({
        type: 'apiToken',
        apiToken: Redacted.make('offline-test-token'),
        accountId,
        source: { type: 'env' },
      }),
    ),
    Layer.succeed(Stack, {
      name: 'OwnershipProbe',
      stage: 'probe',
      resources: {},
      bindings: {},
      actions: {},
    }),
    Layer.succeed(AlchemyContext, {
      dotAlchemy: '.alchemy',
      dev: false,
      adopt: options.adopt ?? false,
    }),
    Layer.succeed(AdoptPolicy, options.adopt ?? false),
    Layer.succeed(Stage, 'probe'),
  );
  return { requests, services, bindingWrites };
}

async function precreate(
  tags: readonly string[],
  options: FixtureOptions = {},
) {
  const { requests, services } = fixture(tags, options);
  const program = Effect.gen(function* () {
    const provider = yield* Provider.Provider<Cloudflare.Worker>(
      Cloudflare.Worker.Type,
    );
    if (!provider.precreate)
      return yield* Effect.die('Worker provider must implement precreate');
    return yield* provider.precreate({
      id: 'Website',
      fqn: 'Website',
      instanceId: 'probe-instance',
      news: {
        name: 'existing-worker',
        script: 'export default {}',
        workersDev: false,
        namespace: options.namespace,
      },
      bindings: [],
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
        Cloudflare.LiveWorkerProvider().pipe(Layer.provide(services)),
      ),
      Effect.provide(services),
      Effect.scoped,
    ),
  );
  return { exit, requests };
}

async function cyclicApply(
  options: FixtureOptions & {
    override?: boolean;
    unresolved?: 'name' | 'namespace';
    replace?: boolean;
    delegated?: 'version' | 'preview';
    resolveNamespaceOnRetry?: boolean;
    useRealDiff?: boolean;
    useRealProvider?: boolean;
    cycle?: boolean;
  } = {},
) {
  const { requests, services, bindingWrites } = fixture([], options);
  const reconciliations: unknown[] = [];
  const deletions: unknown[] = [];
  const program = Effect.gen(function* () {
    const binding = yield* Binding('Binding', {});
    const declaration = Worker('Website', {
      name: options.unresolved === 'name' ? binding.id : 'existing-worker',
      namespace: options.unresolved === 'namespace' ? binding.id : undefined,
      version:
        options.delegated === 'version'
          ? { parent: 'parent-worker' }
          : undefined,
      preview:
        options.delegated === 'preview' ? { of: 'parent-worker' } : undefined,
      script: 'export default {}',
      env: { BINDING: binding.id },
      workersDev: false,
    });
    const output = yield* options.override === undefined
      ? declaration
      : declaration.pipe(Effect.provideService(AdoptPolicy, options.override));
    if (!options.replace && options.cycle !== false)
      yield* binding.bind('worker', { worker: output.workerName });
    const stack = yield* Stack;
    const context = yield* Effect.context<
      | Provider.Provider<ProbeWorker>
      | Provider.Provider<Binding>
      | State
      | Stack
      | Stage
    >();
    const compiled = { ...stack, output, services: context };
    const store = yield* yield* State;
    const key = { stack: stack.name, stage: 'probe', fqn: 'Website' };
    if (options.replace) {
      yield* store.set({
        ...key,
        value: {
          workerAccountId: accountId,
          status: 'created',
          fqn: 'Website',
          logicalId: 'Website',
          resourceType: Worker.Type,
          namespace: undefined,
          instanceId: 'old-generation',
          providerVersion: 0,
          props: { name: 'old-worker' },
          attr: { workerName: 'old-worker', workerId: 'old-id' },
          bindings: [],
          downstream: [],
        },
      });
    }
    const plan = yield* Plan.make(compiled);
    expect(plan.cycleMembers.has('Website')).toBe(
      !options.replace && options.cycle !== false,
    );
    expect(plan.resources.Website?.action).toBe(
      options.replace ? 'replace' : 'create',
    );
    const exit = yield* Effect.exit(Apply.apply(plan));
    const state = yield* store.get(key);
    const initialRequests = [...requests];
    if (options.delegated || options.useRealProvider)
      return { exit, retry: exit, state, retryState: state, initialRequests };
    if (options.resolveNamespaceOnRetry) {
      output.Props.namespace = 'dispatch';
      output.Props.env = { BINDING: 'binding-id' };
    }
    const retryPlan = yield* Plan.make(compiled);
    if (options.resolveNamespaceOnRetry)
      expect(retryPlan.resources.Website?.action).toBe('replace');
    const retry = yield* Effect.exit(Apply.apply(retryPlan));
    const retryState = yield* store.get(key);
    return { exit, retry, state, retryState, initialRequests };
  });
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(
        Provider.effect(
          Worker,
          Provider.Provider<Cloudflare.Worker>(Cloudflare.Worker.Type).pipe(
            Effect.map((provider) => ({
              list: provider.list,
              read: provider.read,
              precreate: provider.precreate,
              diff: options.useRealProvider
                ? provider.diff
                : options.replace
                  ? () => Effect.succeed({ action: 'replace' as const })
                  : options.useRealDiff
                    ? provider.diff
                    : undefined,
              reconcile: options.useRealProvider
                ? provider.reconcile
                : ({
                    news,
                    output,
                  }: Parameters<typeof provider.reconcile>[0]) =>
                    Effect.gen(function* () {
                      reconciliations.push(news);
                      if (output) return output;
                      return yield* Effect.die(
                        'The ownership probe reached reconciliation',
                      );
                    }),
              delete: options.useRealProvider
                ? provider.delete
                : ({ output }: Parameters<typeof provider.delete>[0]) =>
                    Effect.sync(() => {
                      deletions.push(output);
                    }),
            })),
          ),
        ).pipe(
          Layer.provide(
            Cloudflare.LiveWorkerProvider().pipe(Layer.provide(services)),
          ),
        ),
      ),
      Effect.provide(services),
      Effect.scoped,
    ),
  );
  return { ...result, requests, reconciliations, bindingWrites, deletions };
}

const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? exit.cause.reasons.find(Cause.isFailReason)?.error
    : undefined;

describe('the installed Cloudflare Worker precreate ownership guard', () => {
  test('the unmodified provider refuses an unresolved acyclic foreign Worker before any mutation request', async () => {
    const result = await cyclicApply({
      cycle: false,
      useRealProvider: true,
      healthyExisting: true,
    });
    expect(failure(result.exit)).toMatchObject({ _tag: 'OwnedBySomeoneElse' });
    expect(
      result.requests.some((request) => request.path.endsWith('/settings')),
    ).toBe(true);
    expect(result.requests.every((request) => request.method === 'GET')).toBe(
      true,
    );
    expect(
      result.state && 'attr' in result.state ? result.state.attr : undefined,
    ).toBeUndefined();
  });
  test.each([
    { tags: [] },
    {
      tags: [
        'alchemy:stack:Other',
        'alchemy:stage:probe',
        'alchemy:id:Website',
      ],
    },
    {
      tags: [
        'alchemy:stack:OwnershipProbe',
        'alchemy:stage:other',
        'alchemy:id:Website',
      ],
    },
    {
      tags: [
        'alchemy:stack:OwnershipProbe',
        'alchemy:stage:probe',
        'alchemy:id:Other',
      ],
    },
  ])('refuses mismatched ownership before returning attributes', async ({
    tags,
  }) => {
    const result = await precreate(tags);
    expect(failure(result.exit)).toMatchObject({
      _tag: 'OwnedBySomeoneElse',
      logicalId: 'Website',
    });
    expect(result.requests).toHaveLength(1);
    expect(result.requests.every((request) => request.method === 'GET')).toBe(
      true,
    );
  });

  test('reuses a Worker with this stack, stage, and logical ID', async () => {
    const result = await precreate(ownerTags);
    expect(Exit.isSuccess(result.exit)).toBe(true);
    if (Exit.isSuccess(result.exit))
      expect(result.exit.value).toMatchObject({
        workerName: 'existing-worker',
        workerId: 'immutable-id',
      });
  });

  test('requires explicit permission to reuse a foreign Worker', async () => {
    const result = await precreate([], { adopt: true });
    expect(Exit.isSuccess(result.exit)).toBe(true);
  });

  test('fails closed when existing script ownership cannot be read', async () => {
    const result = await precreate([], { noVersions: true });
    expect(failure(result.exit)).toMatchObject({ _tag: 'WorkerHasNoVersions' });
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.method).toBe('GET');
  });

  test.each([
    false,
    true,
  ])('tolerates missing versions only with trusted attributes (%s)', async (trusted) => {
    const owned = await precreate(ownerTags);
    if (!Exit.isSuccess(owned.exit))
      throw new Error('The owned fixture must return attributes');
    const attributes = owned.exit.value;
    const { services, requests } = fixture([], {
      noVersions: true,
      normalOwned: true,
    });
    const program = Effect.gen(function* () {
      const provider = yield* Provider.Provider<Cloudflare.Worker>(
        Cloudflare.Worker.Type,
      );
      if (!provider.read)
        return yield* Effect.die('Worker provider must implement read');
      return yield* provider.read({
        id: 'Website',
        fqn: 'Website',
        instanceId: 'probe-instance',
        olds: { name: 'existing-worker', workersDev: false },
        output: trusted ? attributes : undefined,
      });
    });
    const exit = await Effect.runPromise(
      program.pipe(
        Effect.exit,
        Effect.provide(
          Cloudflare.LiveWorkerProvider().pipe(Layer.provide(services)),
        ),
        Effect.provide(services),
        Effect.scoped,
      ),
    );
    if (trusted) {
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) expect(exit.value).toBeUndefined();
    } else {
      expect(failure(exit)).toMatchObject({ _tag: 'WorkerHasNoVersions' });
    }
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  test('checks ownership before returning a dispatch-namespace stub', async () => {
    const result = await precreate([], { namespace: 'dispatch' });
    expect(failure(result.exit)).toMatchObject({ _tag: 'OwnedBySomeoneElse' });
    expect(result.requests).toHaveLength(1);
  });

  test('does not persist foreign cyclic attributes, including on retry', async () => {
    const result = await cyclicApply();
    expect(failure(result.exit)).toMatchObject({ _tag: 'OwnedBySomeoneElse' });
    expect(failure(result.retry)).toMatchObject({ _tag: 'OwnedBySomeoneElse' });
    for (const state of [result.state, result.retryState]) {
      expect(state && 'attr' in state ? state.attr : undefined).toBeUndefined();
    }
    expect(result.initialRequests).toHaveLength(1);
    expect(result.requests).toHaveLength(2);
    expect(result.reconciliations).toEqual([]);
    expect(result.bindingWrites).toEqual([]);
    expect(result.requests.every((request) => request.method === 'GET')).toBe(
      true,
    );
  });

  test('honors resource-level refusal even when global adoption is enabled', async () => {
    const result = await cyclicApply({ adopt: true, override: false });
    expect(failure(result.exit)).toMatchObject({ _tag: 'OwnedBySomeoneElse' });
    expect(failure(result.retry)).toMatchObject({ _tag: 'OwnedBySomeoneElse' });
    expect(result.requests).toHaveLength(2);
  });

  test('allows a resource-level takeover under global refusal in a cycle', async () => {
    const result = await cyclicApply({ adopt: false, override: true });
    expect(failure(result.exit)).toBeUndefined();
    expect(result.exit).toMatchObject({ _tag: 'Success' });
    expect(result.reconciliations).toHaveLength(1);
    expect(result.bindingWrites).toHaveLength(1);
    expect(result.state).toMatchObject({
      attr: { workerName: 'existing-worker' },
    });
  });

  test.each([
    'name',
    'namespace',
  ] as const)('rejects an unresolved cyclic %s before any API request', async (unresolved) => {
    const result = await cyclicApply({ unresolved });
    expect(failure(result.exit)).toMatchObject({
      _tag: 'UnresolvedWorkerIdentity',
    });
    expect(failure(result.retry)).toMatchObject({
      _tag: 'UnresolvedWorkerIdentity',
    });
    expect(result.initialRequests).toEqual([]);
    expect(result.requests).toEqual([]);
    expect(result.requests.every((request) => request.method === 'GET')).toBe(
      true,
    );
  });

  test('does not recover a rejected dispatch identity from an owned normal Worker on retry', async () => {
    const result = await cyclicApply({
      unresolved: 'namespace',
      normalOwned: true,
    });
    expect(failure(result.exit)).toMatchObject({
      _tag: 'UnresolvedWorkerIdentity',
    });
    expect(failure(result.retry)).toMatchObject({
      _tag: 'UnresolvedWorkerIdentity',
    });
    expect(result.reconciliations).toEqual([]);
    expect(result.requests).toEqual([]);
    expect(
      result.retryState && 'attr' in result.retryState
        ? result.retryState.attr
        : undefined,
    ).toBeUndefined();
  });

  test('does not delete a normal Worker after a rejected namespace resolves on retry', async () => {
    const result = await cyclicApply({
      unresolved: 'namespace',
      normalOwned: true,
      dispatchOwned: true,
      resolveNamespaceOnRetry: true,
      useRealDiff: true,
    });
    expect(failure(result.exit)).toMatchObject({
      _tag: 'UnresolvedWorkerIdentity',
    });
    expect(result.state).toMatchObject({ workerIdentityResolved: false });
    expect(
      JSON.parse(JSON.stringify(encodeState(result.state)), reviveState),
    ).toMatchObject({ workerIdentityResolved: false });
    expect(Exit.isSuccess(result.retry)).toBe(true);
    expect(result.retryState).toMatchObject({
      attr: { namespace: 'dispatch' },
    });
    expect(result.deletions).toEqual([]);
    expect(
      result.requests.every((request) => request.path.includes('/dispatch/')),
    ).toBe(true);
  });

  test('refuses an acyclic replacement when ownership has no observable version', async () => {
    const result = await cyclicApply({
      replace: true,
      noVersions: true,
      normalOwned: true,
    });
    expect(failure(result.exit)).toMatchObject({ _tag: 'WorkerHasNoVersions' });
    expect(failure(result.retry)).toMatchObject({
      _tag: 'WorkerHasNoVersions',
    });
    expect(result.reconciliations).toEqual([]);
    expect(result.requests.every((request) => request.method === 'GET')).toBe(
      true,
    );
  });

  test.each([
    'version',
    'preview',
  ] as const)('preserves delegated %s precreation with an unresolved local name', async (delegated) => {
    const result = await cyclicApply({ delegated, unresolved: 'name' });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reconciliations).toHaveLength(1);
    expect(result.requests).toEqual([]);
  });
});
