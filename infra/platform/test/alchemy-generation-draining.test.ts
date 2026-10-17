import { expect, test } from 'bun:test';
import * as Apply from 'alchemy/Apply';
import { CloudflareEnvironment } from 'alchemy/Cloudflare';
import * as Plan from 'alchemy/Plan';
import * as Provider from 'alchemy/Provider';
import { Resource } from 'alchemy/Resource';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { inMemoryState, State } from 'alchemy/State';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

interface Worker
  extends Resource<
    'Cloudflare.Worker',
    { name: string; binding: string },
    { name: string; accountId: string }
  > {}
const Worker = Resource<Worker>('Cloudflare.Worker');
interface Binding
  extends Resource<
    'Probe.Binding',
    Record<string, never>,
    { id: string },
    { worker: string }
  > {}
const Binding = Resource<Binding>('Probe.Binding');
const accountId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test.each([
  'deferred',
  'completed',
  'partial',
])('cyclic convergence retains only unfinished generation cleanup: %s', async (scenario) => {
  const deferred = scenario !== 'completed';
  const deletions: string[] = [];
  const bindings: string[] = [];
  let draining = deferred;
  const stack = {
    name: 'GenerationProbe',
    stage: 'probe',
    resources: {},
    bindings: {},
    actions: {},
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const stubConsumed = yield* Deferred.make<void>();
      const old = {
        status: 'created' as const,
        fqn: 'Website',
        logicalId: 'Website',
        resourceType: Worker.Type,
        namespace: undefined,
        instanceId: '11111111111111111111111111111111',
        providerVersion: 0,
        workerAccountId: accountId,
        workerIdentityResolved: true,
        props: { name: 'old-worker', binding: 'old-binding' },
        attr: { name: 'old-worker', accountId },
        bindings: [],
        downstream: [],
      };
      const middle = {
        ...old,
        instanceId: '33333333333333333333333333333333',
        props: { name: 'middle-worker', binding: 'old-binding' },
        attr: { name: 'middle-worker', accountId },
      };
      const drainingId =
        scenario === 'partial' ? middle.instanceId : old.instanceId;
      const providers = Layer.mergeAll(
        Provider.succeed(Worker, {
          diff: () => Effect.succeed({ action: 'update' as const }),
          reconcile: ({ news }) =>
            Effect.gen(function* () {
              bindings.push(news.binding);
              if (news.binding === 'stub-id')
                yield* Deferred.succeed(stubConsumed, undefined);
              return { name: news.name, accountId };
            }),
          delete: ({ instanceId }) =>
            Effect.gen(function* () {
              deletions.push(instanceId);
              if (draining && instanceId === drainingId)
                return yield* Effect.fail(
                  new Provider.DeleteInProgress({ message: 'draining' }),
                );
            }),
        }),
        Provider.succeed(Binding, {
          precreate: () => Effect.succeed({ id: 'stub-id' }),
          reconcile: () =>
            Deferred.await(stubConsumed).pipe(Effect.as({ id: 'final-id' })),
          delete: () => Effect.void,
        }),
      );
      yield* Effect.gen(function* () {
        const binding = yield* Binding('Binding', {});
        const worker = yield* Worker('Website', {
          name: 'worker',
          binding: binding.id,
        });
        yield* binding.bind('worker', { worker: worker.name });
        const store = yield* yield* State;
        const key = { stack: stack.name, stage: stack.stage, fqn: 'Website' };
        yield* store.set({
          ...key,
          value: {
            ...old,
            status: 'replaced',
            instanceId: '22222222222222222222222222222222',
            props: { name: 'worker', binding: 'old-binding' },
            attr: { name: 'worker', accountId },
            old:
              scenario === 'partial'
                ? { ...middle, status: 'replaced', old, deleteFirst: false }
                : old,
            deleteFirst: false,
          },
        });
        const providerServices = yield* Effect.context<
          | Provider.Provider<Worker>
          | Provider.Provider<Binding>
          | State
          | Stack
          | Stage
        >();
        const input = { ...stack, output: worker, services: providerServices };
        const plan = yield* Plan.make(input);
        expect([...plan.cycleMembers].sort()).toEqual(['Binding', 'Website']);
        yield* Apply.apply(plan);
        const after = yield* store.get(key);
        expect(bindings).toEqual(['stub-id', 'final-id']);
        expect(after).toMatchObject({
          status: deferred ? 'replaced' : 'updated',
          instanceId: '22222222222222222222222222222222',
          workerAccountId: accountId,
          props: { name: 'worker', binding: 'final-id' },
        });
        if (deferred) {
          expect(after).toMatchObject({
            old: scenario === 'partial' ? middle : old,
          });
          if (after?.status === 'replaced')
            expect(after.old).not.toHaveProperty('old');
          draining = false;
          yield* Apply.apply(yield* Plan.make(input));
        }
        expect(deletions).toEqual(
          scenario === 'partial'
            ? [middle.instanceId, old.instanceId, middle.instanceId]
            : Array(deferred ? 2 : 1).fill(old.instanceId),
        );
        const final = yield* store.get(key);
        expect(final).not.toHaveProperty('old');
        expect(final).toMatchObject({
          workerAccountId: accountId,
          props: { name: 'worker', binding: 'final-id' },
        });
      }).pipe(Effect.provide(providers));
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          inMemoryState(),
          Layer.succeed(Stack, stack),
          Layer.succeed(Stage, 'probe'),
          Layer.succeed(
            CloudflareEnvironment,
            Effect.succeed({
              type: 'apiToken',
              apiToken: Redacted.make('offline-token'),
              accountId,
              source: { type: 'env' },
            }),
          ),
        ),
      ),
      Effect.scoped,
    ),
  );
}, 10_000);
