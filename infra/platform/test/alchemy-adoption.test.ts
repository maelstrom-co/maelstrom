import { describe, expect, test } from 'bun:test';
import { AdoptPolicy, Unowned } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Apply from 'alchemy/Apply';
import { CloudflareEnvironment } from 'alchemy/Cloudflare';
import * as Plan from 'alchemy/Plan';
import * as Provider from 'alchemy/Provider';
import { Resource } from 'alchemy/Resource';
import * as Stack from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { inMemoryState, State } from 'alchemy/State';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Redacted from 'effect/Redacted';

const accountId = '00000000000000000000000000000000';
const accountEnvironment = Layer.succeed(
  CloudflareEnvironment,
  Effect.succeed({
    type: 'apiToken',
    apiToken: Redacted.make('offline-token'),
    accountId,
    source: { type: 'env' },
  }),
);

interface Upstream
  extends Resource<
    'Probe.Upstream',
    Record<string, never>,
    { id: string },
    { worker: string }
  > {}
const Upstream = Resource<Upstream>('Probe.Upstream');
interface Worker
  extends Resource<
    'Cloudflare.Worker' | 'Hetzner.Volume',
    { name: string; binding: string },
    { name: string }
  > {}
const Worker = Resource<Worker>('Cloudflare.Worker');
const Volume = Resource<Worker>('Hetzner.Volume');

async function probe(
  observation: 'foreign' | 'owned' | 'absent',
  options: {
    disableDeferral?: boolean;
    adopt?: boolean;
    precreate?: boolean;
    replace?: boolean;
    override?: boolean;
    nonWorker?: boolean;
    interrupted?: boolean;
    deleteFirst?: boolean;
    cycle?: boolean;
    unresolvedName?: boolean;
    resume?: boolean;
    resumeCreate?: 'noop' | 'update' | 'deleting';
  } = {},
) {
  const adopt = options.adopt ?? false;
  const reads: unknown[] = [];
  const writes: unknown[] = [];
  const precreates: unknown[] = [];
  const deletions: unknown[] = [];
  const events: string[] = [];
  const adoptionPolicies: (boolean | undefined)[] = [];
  const resource = options.nonWorker ? Volume : Worker;
  const provider = Provider.succeed(Upstream, {
    list: () => Effect.succeed([]),
    precreate: () => Effect.succeed({ id: 'resolved-binding-id' }),
    reconcile: () => Effect.succeed({ id: 'resolved-binding-id' }),
    delete: () => Effect.void,
  });
  const workerProvider = Provider.succeed(resource, {
    list: () => Effect.succeed([]),
    precreate: options.precreate
      ? ({ news }) =>
          Effect.gen(function* () {
            precreates.push(news);
            const policy = yield* Effect.serviceOption(AdoptPolicy);
            adoptionPolicies.push(
              Option.isSome(policy) ? policy.value : undefined,
            );
            return { name: 'existing-worker' };
          })
      : undefined,
    diff: options.resumeCreate
      ? () =>
          Effect.succeed({
            action:
              options.resumeCreate === 'update'
                ? ('update' as const)
                : ('noop' as const),
          })
      : options.resume
        ? () => Effect.succeed({ action: 'update' as const })
        : options.replace
          ? () =>
              Effect.succeed({
                action: 'replace' as const,
                deleteFirst: options.deleteFirst,
              })
          : undefined,
    read: ({ olds }) =>
      Effect.sync(() => {
        reads.push(olds);
        const attrs = {
          name: olds.name === 'old-worker' ? 'old-worker' : 'existing-worker',
        };
        return observation === 'foreign'
          ? Unowned(attrs)
          : observation === 'owned'
            ? attrs
            : undefined;
      }),
    reconcile: ({ news, output, olds }) =>
      Effect.sync(() => {
        writes.push({ news, output, olds });
        events.push('reconcile');
        return { name: news.name };
      }),
    delete: ({ output }) =>
      Effect.sync(() => {
        deletions.push(output);
        events.push('delete');
      }),
  });
  const stack = Stack.Stack.of({
    name: `Probe-${observation}`,
    stage: 'probe',
    resources: {},
    bindings: {},
    actions: {},
  });
  const program = Effect.gen(function* () {
    const upstream = yield* Upstream('Binding', {});
    const declaration = resource('Website', {
      name: options.unresolvedName ? upstream.id : 'existing-worker',
      binding: upstream.id,
    });
    const output = yield* options.override === undefined
      ? declaration
      : declaration.pipe(Effect.provideService(AdoptPolicy, options.override));
    if (options.cycle) yield* upstream.bind('worker', { worker: output.name });
    const services = yield* Effect.context<
      | Provider.Provider<Upstream>
      | Provider.Provider<Worker>
      | State
      | Stack.Stack
      | Stage
    >();
    const compiled = { ...stack, output, services };
    const store = yield* yield* State;
    const key = { stack: compiled.name, stage: 'probe', fqn: 'Website' };
    if (options.resumeCreate) {
      yield* store.set({
        ...key,
        value: {
          status: options.resumeCreate === 'deleting' ? 'deleting' : 'creating',
          attr: undefined,
          fqn: 'Website',
          logicalId: 'Website',
          resourceType: Worker.Type,
          namespace: undefined,
          instanceId: 'interrupted-create',
          providerVersion: 0,
          workerAccountId: accountId,
          workerIdentityResolved: false,
          props: { name: 'existing-worker', binding: 'prior-binding' },
          bindings: [],
          downstream: [],
        },
      });
    }
    if (options.replace) {
      const old = {
        status: 'created' as const,
        fqn: 'Website',
        logicalId: 'Website',
        resourceType: resource.Type,
        namespace: undefined,
        instanceId: 'old-generation',
        providerVersion: 0,
        workerAccountId: resource.Type === Worker.Type ? accountId : undefined,
        props: { name: 'existing-worker', binding: 'old-binding' },
        attr: { name: 'existing-worker' },
        bindings: [],
        downstream: [],
      };
      yield* store.set({
        ...key,
        value: options.resume
          ? {
              ...old,
              status: 'replacing',
              instanceId: 'replacement-generation',
              props: {
                name: 'existing-worker',
                binding: 'resolved-binding-id',
              },
              deleteFirst: true,
              old,
            }
          : {
              ...(options.interrupted
                ? { status: 'creating' as const }
                : { status: 'created' as const, attr: { name: 'old-worker' } }),
              fqn: 'Website',
              logicalId: 'Website',
              resourceType: resource.Type,
              namespace: undefined,
              instanceId: 'old-generation',
              providerVersion: 0,
              workerAccountId:
                resource.Type === Worker.Type ? accountId : undefined,
              props: { name: 'old-worker', binding: 'old-binding' },
              bindings: [],
              downstream: [],
            },
      });
    }
    const plan = yield* Plan.make(compiled);
    expect(reads).toHaveLength(
      options.interrupted && options.nonWorker ? 1 : 0,
    );
    expect(writes).toHaveLength(0);
    const planned = plan.resources.Website;
    expect(planned?.action).toBe(options.replace ? 'replace' : 'create');
    if (!options.replace && options.resumeCreate !== 'deleting')
      expect(planned).toMatchObject({
        deferredAdoption: { adopt: options.override ?? adopt },
      });
    if (options.disableDeferral && planned?.action === 'create') {
      delete planned.deferredAdoption;
    }
    const exit = yield* Effect.exit(Apply.apply(plan));
    const state = yield* store.get(key);
    return { exit, state };
  });
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          provider,
          workerProvider,
          inMemoryState(),
          accountEnvironment,
        ),
      ),
      Effect.provideService(Stack.Stack, stack),
      Effect.scoped,
      Effect.provideService(Stage, 'probe'),
      Effect.provideService(AdoptPolicy, adopt),
      Effect.provideService(AlchemyContext, {
        dotAlchemy: '.alchemy',
        dev: false,
        adopt,
      }),
    ),
  );
  return {
    ...result,
    reads,
    writes,
    precreates,
    deletions,
    events,
    adoptionPolicies,
  };
}

async function destroyReplacement(workerIdentityResolved: boolean) {
  const reads: unknown[] = [];
  const deletions: unknown[] = [];
  const stack = Stack.Stack.of({
    name: 'CleanupProbe',
    stage: 'probe',
    resources: {},
    bindings: {},
    actions: {},
  });
  const provider = Provider.succeed(Worker, {
    list: () => Effect.succeed([]),
    read: ({ olds }) =>
      Effect.sync(() => {
        reads.push(olds);
        return { name: olds.name };
      }),
    reconcile: ({ news }) => Effect.succeed({ name: news.name }),
    delete: ({ output }) =>
      Effect.sync(() => {
        deletions.push(output);
      }),
  });
  const program = Effect.gen(function* () {
    const store = yield* yield* State;
    const key = { stack: stack.name, stage: 'probe', fqn: 'Website' };
    const old = {
      status: 'created' as const,
      fqn: 'Website',
      logicalId: 'Website',
      resourceType: Worker.Type,
      namespace: undefined,
      instanceId: 'old-generation',
      providerVersion: 0,
      workerAccountId: accountId,
      props: { name: 'old-worker', binding: 'binding-id' },
      attr: { name: 'old-worker' },
      bindings: [],
      downstream: [],
    };
    const current = {
      ...old,
      status: 'replacing' as const,
      instanceId: 'current-generation',
      props: { name: 'current-worker', binding: 'binding-id' },
      attr: undefined,
      workerIdentityResolved,
      old,
      deleteFirst: false,
    };
    yield* store.set({ ...key, value: current });
    const plan = yield* Plan.destroy(stack);
    const exit = yield* Effect.exit(Apply.apply(plan));
    const state = yield* store.get(key);
    return { exit, state };
  });
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(provider, inMemoryState(), accountEnvironment),
      ),
      Effect.provideService(Stack.Stack, stack),
      Effect.provideService(Stage, 'probe'),
      Effect.scoped,
    ),
  );
  return { ...result, reads, deletions };
}

async function replaceWithLocalWorker(failFirst: boolean) {
  const events: string[] = [];
  let attempts = 0;
  const local = {
    Type: Worker.Type,
    mode: 'local' as const,
    list: () => Effect.succeed([]),
    diff: () => Effect.succeed({ action: 'update' as const }),
    precreate: () => Effect.die('An acyclic local Worker needs no placeholder'),
    reconcile: () =>
      Effect.gen(function* () {
        events.push('local-start');
        if (++attempts === 1 && failFirst)
          return yield* Effect.die('Local startup failed');
        return { name: 'local-worker' };
      }),
    delete: () => Effect.die('The old generation belongs to the live provider'),
  };
  const live = {
    ...local,
    mode: 'live' as const,
    read: () => Effect.die('Local replacement must not probe cloud ownership'),
    delete: () => Effect.sync(() => events.push('live-delete')),
  };
  const provider = Provider.succeed(Worker, {
    ...local,
    modes: { local: Effect.succeed(local), live: Effect.succeed(live) },
  });
  const stack = Stack.Stack.of({
    name: 'LocalReplacementProbe',
    stage: 'probe',
    resources: {},
    bindings: {},
    actions: {},
  });
  const program = Effect.gen(function* () {
    const output = yield* Worker('Website', {
      name: 'local-worker',
      binding: 'local-binding',
    });
    const services = yield* Effect.context<
      Provider.Provider<Worker> | State | Stack.Stack | Stage
    >();
    const compiled = { ...stack, output, services };
    const store = yield* yield* State;
    const key = { stack: stack.name, stage: 'probe', fqn: 'Website' };
    yield* store.set({
      ...key,
      value: {
        status: 'created',
        fqn: 'Website',
        logicalId: 'Website',
        resourceType: Worker.Type,
        namespace: undefined,
        instanceId: 'live-generation',
        providerVersion: 0,
        providerMode: 'live',
        workerAccountId: accountId,
        props: { name: 'live-worker', binding: 'live-binding' },
        attr: { name: 'live-worker' },
        bindings: [],
        downstream: [],
      },
    });
    const plan = yield* Plan.make(compiled);
    expect(plan.resources.Website).toMatchObject({
      action: 'replace',
      mode: 'local',
    });
    expect(plan.cycleMembers.has('Website')).toBe(false);
    const first = yield* Effect.exit(Apply.apply(plan));
    if (failFirst) {
      expect(Exit.isFailure(first)).toBe(true);
      expect(events).toEqual(['local-start']);
      expect(yield* store.get(key)).toMatchObject({
        status: 'replacing',
        old: { attr: { name: 'live-worker' } },
      });
      const retry = yield* Plan.make(compiled);
      expect(Exit.isSuccess(yield* Effect.exit(Apply.apply(retry)))).toBe(true);
    } else {
      expect(Exit.isSuccess(first)).toBe(true);
    }
    expect(yield* store.get(key)).toMatchObject({
      status: 'created',
      providerMode: 'local',
      attr: { name: 'local-worker' },
    });
  });
  await Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(provider, inMemoryState(), accountEnvironment),
      ),
      Effect.provideService(Stack.Stack, stack),
      Effect.provideService(Stage, 'probe'),
      Effect.provideService(AlchemyContext, {
        dotAlchemy: '.alchemy',
        dev: true,
        adopt: false,
      }),
      Effect.scoped,
    ),
  );
  return events;
}

describe('local Worker replacement isolation', () => {
  test.each([
    false,
    true,
  ])('switches a live Worker to a local provider without a cloud reader (retry: %s)', async (failFirst) => {
    expect(await replaceWithLocalWorker(failFirst)).toEqual(
      failFirst
        ? ['local-start', 'local-start', 'live-delete']
        : ['local-start', 'live-delete'],
    );
  });
});

describe('upstream deferred ownership checks with unresolved bindings', () => {
  test.each([
    'fresh',
    'noop',
    'update',
    'deleting',
  ] as const)('refuses a foreign Worker before reconciliation through the %s create producer', async (producer) => {
    const result = await probe('foreign', {
      resumeCreate: producer === 'fresh' ? undefined : producer,
    });
    expect(Exit.isFailure(result.exit)).toBe(true);
    if (Exit.isFailure(result.exit))
      expect(
        result.exit.cause.reasons.find(Cause.isFailReason)?.error,
      ).toMatchObject({ _tag: 'OwnedBySomeoneElse' });
    expect(result.writes).toEqual([]);
  });
  test('refuses a foreign resource when precreate returns existing attributes', async () => {
    const result = await probe('foreign', { precreate: true });
    expect(Exit.isFailure(result.exit)).toBe(true);
    expect(result.reads).toEqual([
      { name: 'existing-worker', binding: 'resolved-binding-id' },
    ]);
    expect(result.writes).toEqual([]);
    expect(result.precreates).toEqual([]);
  });

  test('detects the unsafe path when deferred adoption is disabled', async () => {
    const result = await probe('foreign', { disableDeferral: true });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([]);
    expect(result.writes).toHaveLength(1);
  });

  test('refuses a foreign resource before reconciliation or adoption into state', async () => {
    const result = await probe('foreign');
    expect(Exit.isFailure(result.exit)).toBe(true);
    if (Exit.isFailure(result.exit)) {
      const failure = result.exit.cause.reasons.find(Cause.isFailReason);
      expect(failure?.error).toMatchObject({
        _tag: 'OwnedBySomeoneElse',
        logicalId: 'Website',
      });
    }
    expect(result.reads).toEqual([
      { name: 'existing-worker', binding: 'resolved-binding-id' },
    ]);
    expect(result.writes).toEqual([]);
    expect(
      result.state && 'attr' in result.state ? result.state.attr : undefined,
    ).toBeUndefined();
  });

  test('recovers an owned resource without requiring takeover permission', async () => {
    const result = await probe('owned');
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([
      { name: 'existing-worker', binding: 'resolved-binding-id' },
    ]);
    expect(result.writes).toEqual([
      {
        news: { name: 'existing-worker', binding: 'resolved-binding-id' },
        output: { name: 'existing-worker' },
        olds: undefined,
      },
    ]);
  });

  test('allows a foreign resource only with explicit takeover permission', async () => {
    const result = await probe('foreign', { adopt: true });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([
      { name: 'existing-worker', binding: 'resolved-binding-id' },
    ]);
    expect(result.writes).toEqual([
      {
        news: { name: 'existing-worker', binding: 'resolved-binding-id' },
        output: { name: 'existing-worker' },
        olds: undefined,
      },
    ]);
  });

  test('creates an absent resource only after probing its resolved identity', async () => {
    const result = await probe('absent');
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([
      { name: 'existing-worker', binding: 'resolved-binding-id' },
    ]);
    expect(result.writes).toEqual([
      {
        news: { name: 'existing-worker', binding: 'resolved-binding-id' },
        output: undefined,
        olds: undefined,
      },
    ]);
  });
});

describe('provider isolation for Worker ownership checks', () => {
  test.each([
    false,
    true,
  ])('preserves ambient policy for non-Worker cyclic precreation (replace: %s)', async (replace) => {
    const result = await probe('owned', {
      nonWorker: true,
      cycle: true,
      precreate: true,
      adopt: true,
      override: false,
      replace,
    });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.adoptionPolicies).toEqual([true]);
  });
  test('does not use a generic provider read to find a replacement generation', async () => {
    const result = await probe('owned', { replace: true, nonWorker: true });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([]);
    expect(result.writes).toEqual([
      {
        news: { name: 'existing-worker', binding: 'resolved-binding-id' },
        olds: undefined,
        output: undefined,
      },
    ]);
    expect(result.deletions).toEqual([{ name: 'old-worker' }]);
    expect(result.state).toMatchObject({ attr: { name: 'existing-worker' } });
  });

  test('recovers a non-Worker old generation before delete-first replacement', async () => {
    const result = await probe('owned', {
      replace: true,
      nonWorker: true,
      interrupted: true,
      deleteFirst: true,
    });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([
      { name: 'old-worker', binding: 'old-binding' },
    ]);
    expect(result.deletions).toEqual([{ name: 'old-worker' }]);
    expect(result.writes).toEqual([
      {
        news: { name: 'existing-worker', binding: 'resolved-binding-id' },
        olds: undefined,
        output: undefined,
      },
    ]);
    expect(result.events).toEqual(['delete', 'reconcile']);
  });
});

describe('replacement ownership checks after resolving the new identity', () => {
  test('clears resumed precreation attributes after acyclic delete-first cleanup', async () => {
    const result = await probe('owned', { replace: true, resume: true });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.deletions).toEqual([{ name: 'existing-worker' }]);
    expect(result.writes).toEqual([
      {
        news: { name: 'existing-worker', binding: 'resolved-binding-id' },
        olds: undefined,
        output: undefined,
      },
    ]);
  });
  test('does not infer a script identity from an attribute-free checkpoint with a known account', async () => {
    const result = await probe('owned', { replace: true, interrupted: true });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([
      { name: 'existing-worker', binding: 'resolved-binding-id' },
    ]);
    expect(result.deletions).toEqual([]);
    expect(result.state).toMatchObject({ attr: { name: 'existing-worker' } });
  });
  test.each([
    false,
    true,
  ])('refuses a foreign delete-first Worker before deleting the old generation (cyclic: %s)', async (cycle) => {
    const result = await probe('foreign', {
      replace: true,
      deleteFirst: true,
      cycle,
      precreate: true,
    });
    expect(Exit.isFailure(result.exit)).toBe(true);
    if (Exit.isFailure(result.exit))
      expect(
        result.exit.cause.reasons.find(Cause.isFailReason)?.error,
      ).toMatchObject({ _tag: 'OwnedBySomeoneElse' });
    expect(result.deletions).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.precreates).toEqual([]);
  });

  test('refuses an unresolved cyclic delete-first identity before cleanup or precreation', async () => {
    const result = await probe('owned', {
      replace: true,
      deleteFirst: true,
      cycle: true,
      unresolvedName: true,
      precreate: true,
    });
    expect(Exit.isFailure(result.exit)).toBe(true);
    expect(result.deletions).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.precreates).toEqual([]);
  });

  test('does not reuse attributes that delete-first cleanup may invalidate', async () => {
    const result = await probe('owned', { replace: true, deleteFirst: true });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.events).toEqual(['delete', 'reconcile']);
    expect(result.writes).toEqual([
      {
        news: { name: 'existing-worker', binding: 'resolved-binding-id' },
        olds: undefined,
        output: undefined,
      },
    ]);
  });
  test('refuses a foreign replacement without changing either generation', async () => {
    const result = await probe('foreign', { replace: true, precreate: true });
    expect(Exit.isFailure(result.exit)).toBe(true);
    if (Exit.isFailure(result.exit))
      expect(
        result.exit.cause.reasons.find(Cause.isFailReason)?.error,
      ).toMatchObject({ _tag: 'OwnedBySomeoneElse' });
    expect(result.reads).toEqual([
      { name: 'existing-worker', binding: 'resolved-binding-id' },
    ]);
    expect(result.writes).toEqual([]);
    expect(result.precreates).toEqual([]);
    expect(result.deletions).toEqual([]);
    expect(result.state).toMatchObject({
      status: 'replacing',
      old: { attr: { name: 'old-worker' } },
    });
    expect(
      result.state && 'attr' in result.state ? result.state.attr : undefined,
    ).toBeUndefined();
  });

  test('honors resource-level refusal when replacing under global adoption', async () => {
    const result = await probe('foreign', {
      replace: true,
      adopt: true,
      override: false,
    });
    expect(Exit.isFailure(result.exit)).toBe(true);
    expect(result.writes).toEqual([]);
    expect(result.deletions).toEqual([]);
  });

  test.each([
    { observation: 'owned', adopt: false, output: { name: 'existing-worker' } },
    { observation: 'absent', adopt: false, output: undefined },
    {
      observation: 'foreign',
      adopt: true,
      output: { name: 'existing-worker' },
    },
  ] as const)('reconciles an owned, absent, or explicitly adopted replacement', async ({
    observation,
    adopt,
    output,
  }) => {
    const result = await probe(observation, { replace: true, adopt });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([
      { name: 'existing-worker', binding: 'resolved-binding-id' },
    ]);
    expect(result.writes).toEqual([
      {
        news: { name: 'existing-worker', binding: 'resolved-binding-id' },
        olds: undefined,
        output,
      },
    ]);
    expect(result.deletions).toEqual([{ name: 'old-worker' }]);
  });
});

describe('Worker identity provenance through replacement garbage collection', () => {
  test('preserves complete identity when collapsing a replacement during destroy', async () => {
    const result = await destroyReplacement(true);
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([
      { name: 'current-worker', binding: 'binding-id' },
    ]);
    expect(result.deletions).toEqual([
      { name: 'old-worker' },
      { name: 'current-worker' },
    ]);
    expect(result.state).toBeUndefined();
  });

  test('does not reconstruct identity proof from stripped props during destroy', async () => {
    const result = await destroyReplacement(false);
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([]);
    expect(result.deletions).toEqual([{ name: 'old-worker' }]);
    expect(result.state).toBeUndefined();
  });
});
