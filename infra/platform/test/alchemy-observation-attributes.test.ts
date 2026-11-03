import { describe, expect, test } from 'bun:test';

import { AdoptPolicy, Unowned, Unresolved } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Apply from 'alchemy/Apply';
import { isResolved } from 'alchemy/Diff';
import * as Plan from 'alchemy/Plan';
import * as Provider from 'alchemy/Provider';
import { Resource } from 'alchemy/Resource';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { inMemoryState, State } from 'alchemy/State';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';

interface Scope extends Resource<
  'Probe.Scope',
  { value: string },
  { value: string },
  { subject: string }
> {}
const Scope = Resource<Scope>('Probe.Scope');
interface Scoped extends Resource<
  'Probe.Scoped',
  { name: string; scope: string; source?: Scope['Attributes'] },
  { name: string; scope?: string; physicalId: string },
  { self: string }
> {}
const Scoped = Resource<Scoped>('Probe.Scoped');
const key = (value: { name: string; scope?: unknown }) =>
  `${typeof value.scope === 'string' ? value.scope : 'account'}/${value.name}`;
const attributes = (value: { name: string; scope?: string }) => ({
  ...value,
  physicalId: key(value),
});

async function scenario(options: {
  cycle: boolean;
  replace: boolean;
  fail?: boolean;
  read?: boolean;
  retry?: boolean;
  absent?: boolean;
  writeBeforeFailure?: boolean;
  deleteFirst?: boolean;
  resume?: boolean;
  outsideScope?: boolean;
  precreateThrows?: boolean;
  wholeResource?: boolean;
}) {
  const owners = new Map([
    ['account/api', 'SomeoneElse'],
    ['tenant/api', 'Subject'],
  ]);
  if (options.absent) owners.delete('tenant/api');
  const outputs: Array<Scoped['Attributes'] | undefined> = [];
  const bindings: string[] = [];
  let fail = options.fail ?? false;
  const stack = Stack.of({
    name: 'ObservedAttributes',
    stage: 'probe',
    resources: {},
    bindings: {},
    actions: {},
  });
  const services = Layer.mergeAll(
    inMemoryState(),
    Provider.succeed(Scope, {
      diff: () => Effect.succeed({ action: 'update' as const }),
      stables: ['value'],
      precreate: ({ news }) => Effect.succeed(news),
      reconcile: ({ news }) => Effect.succeed(news),
      delete: () => Effect.void,
    }),
    Provider.succeed(Scoped, {
      diff: ({ olds, news }) =>
        Effect.succeed(
          options.resume
            ? { action: 'update' as const }
            : !isResolved(news) || olds.scope !== news.scope
              ? { action: 'replace' as const, deleteFirst: options.deleteFirst }
              : undefined,
        ),
      observe: ({ id, news }) =>
        Effect.sync(() => {
          if (!isResolved(news.scope)) return Unresolved;
          const owner = owners.get(key(news));
          return owner === undefined
            ? undefined
            : owner === id
              ? { name: news.name }
              : Unowned({ name: news.name });
        }),
      read: options.read
        ? ({ id, olds, output }) =>
            Effect.sync(() => {
              const value = output ?? olds;
              const owner = owners.get(key(value));
              return owner === undefined
                ? undefined
                : owner === id
                  ? attributes(value)
                  : Unowned(attributes(value));
            })
        : undefined,
      precreate: ({ id, news }) =>
        Effect.sync(() => {
          if (!isResolved(news.scope))
            return { name: news.name, physicalId: '' };
          owners.set(key(news), id);
          if (options.precreateThrows)
            throw new Error('Interrupted physical precreate');
          return attributes(news);
        }),
      reconcile: ({ id, news, output, bindings: resolved }) =>
        Effect.gen(function* () {
          outputs.push(output);
          for (const binding of resolved) bindings.push(binding.data.self);
          if (fail && !options.writeBeforeFailure)
            return yield* Effect.fail(
              new Error('Simulated interruption before any write'),
            );
          const identity = output ?? news;
          owners.set(key(identity), id);
          if (fail)
            return yield* Effect.fail(
              new Error('Simulated interruption after the physical write'),
            );
          return attributes(identity);
        }),
      delete: ({ output }) =>
        Effect.sync(() => {
          owners.delete(key(output));
        }),
    }),
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const output = yield* Effect.gen(function* () {
        const scope = yield* Scope('Scope', { value: 'tenant' });
        const subject = yield* Scoped('Subject', {
          name: 'api',
          scope: scope.value,
          ...(options.wholeResource ? { source: scope } : {}),
        });
        if (options.cycle) {
          yield* subject.bind('Self', { self: subject.name });
          if (!options.outsideScope)
            yield* scope.bind('Subject', { subject: subject.name });
        }
        return subject;
      }).pipe(Effect.provideService(Stack, stack));
      const context = yield* Effect.context<
        | Provider.Provider<Scope>
        | Provider.Provider<Scoped>
        | State
        | Stage
        | Stack
      >();
      const compiled = { ...stack, output, services: context };
      const store = yield* yield* State;
      const stateKey = { stack: stack.name, stage: 'probe', fqn: 'Subject' };
      if (options.wholeResource) {
        yield* store.set({
          stack: stack.name,
          stage: 'probe',
          fqn: 'Scope',
          value: {
            status: 'created',
            namespace: undefined,
            fqn: 'Scope',
            logicalId: 'Scope',
            resourceType: Scope.Type,
            instanceId: 'scope',
            providerVersion: 0,
            props: { value: 'previous' },
            attr: { value: 'tenant' },
            bindings: [],
            downstream: [],
          },
        });
      }
      if (options.replace) {
        owners.set('old/api', 'Subject');
        const old = {
          status: 'created' as const,
          namespace: undefined,
          fqn: 'Subject',
          logicalId: 'Subject',
          resourceType: Scoped.Type,
          instanceId: 'old',
          providerVersion: 0,
          props: { name: 'api', scope: 'old' },
          attr: attributes({ name: 'api', scope: 'old' }),
          bindings: [],
          downstream: [],
        };
        yield* store.set({
          ...stateKey,
          value: options.resume
            ? {
                ...old,
                status: 'replacing',
                instanceId: 'replacement',
                props: { name: 'api', scope: 'tenant' },
                attr: attributes({ name: 'api', scope: 'tenant' }),
                deleteFirst: true,
                old,
              }
            : old,
        });
      }
      const first = yield* Plan.make(compiled).pipe(
        Effect.flatMap(Apply.apply),
        Effect.exit,
      );
      const checkpoint = yield* store.get(stateKey);
      const firstOutputs = [...outputs];
      fail = false;
      const retry = options.retry
        ? yield* Plan.make(compiled).pipe(
            Effect.flatMap(Apply.apply),
            Effect.exit,
          )
        : undefined;
      const ownersBeforeDestroy = [...owners];
      yield* Plan.destroy(compiled).pipe(Effect.flatMap(Apply.apply));
      return {
        first,
        retry,
        checkpoint,
        firstOutputs,
        bindings,
        owners,
        ownersBeforeDestroy,
      };
    }).pipe(
      Effect.provide(services),
      Effect.provideService(Stack, stack),
      Effect.provideService(Stage, 'probe'),
      Effect.provideService(AdoptPolicy, false),
      Effect.provideService(AlchemyContext, {
        dotAlchemy: '.alchemy',
        dev: false,
        adopt: false,
      }),
      Effect.scoped,
    ),
  );
}

describe('partial ownership evidence cannot select a foreign physical scope', () => {
  for (const cycle of [false, true]) {
    for (const replace of [false, true]) {
      test(`reconciles resolved props without partial evidence (cycle=${cycle}, replace=${replace})`, async () => {
        const result = await scenario({ cycle, replace });
        expect(Exit.isSuccess(result.first)).toBe(true);
        expect(result.firstOutputs[0]).toBeUndefined();
        expect(result.owners.get('account/api')).toBe('SomeoneElse');
        expect(result.owners.has('tenant/api')).toBe(false);
        if (cycle) expect(result.bindings).toContain('api');
      });
      for (const retry of [false, true]) {
        test(`preserves foreign resources after interruption (cycle=${cycle}, replace=${replace}, retry=${retry})`, async () => {
          const result = await scenario({ cycle, replace, fail: true, retry });
          expect(Exit.isFailure(result.first)).toBe(true);
          expect(
            result.checkpoint && 'attr' in result.checkpoint
              ? result.checkpoint.attr
              : undefined,
          ).toBeUndefined();
          if (retry) expect(result.retry?._tag).toBe('Success');
          expect(result.owners.get('account/api')).toBe('SomeoneElse');
        });
      }
    }
    for (const replace of [false, true])
      for (const retry of [false, true]) {
        test(`keeps complete read attributes usable for cleanup (cycle=${cycle}, replace=${replace}, retry=${retry})`, async () => {
          const result = await scenario({
            cycle,
            replace,
            read: true,
            fail: true,
            retry,
          });
          expect(Exit.isFailure(result.first)).toBe(true);
          expect(result.firstOutputs[0]).toEqual(
            attributes({ name: 'api', scope: 'tenant' }),
          );
          expect(result.checkpoint).toMatchObject({
            props: { name: 'api', scope: 'tenant' },
            attr: attributes({ name: 'api', scope: 'tenant' }),
          });
          if (replace)
            expect(result.checkpoint).toMatchObject({
              old: {
                instanceId: 'old',
                attr: attributes({ name: 'api', scope: 'old' }),
              },
            });
          if (retry) expect(result.retry?._tag).toBe('Success');
          expect(result.owners.has('tenant/api')).toBe(false);
          expect(result.owners.get('account/api')).toBe('SomeoneElse');
        });
      }
    test(`recovers a replacement written after a confirmed absence (cycle=${cycle})`, async () => {
      const result = await scenario({
        cycle,
        replace: true,
        read: true,
        absent: true,
        fail: true,
        writeBeforeFailure: true,
      });
      expect(Exit.isFailure(result.first)).toBe(true);
      expect(result.checkpoint).toMatchObject({
        props: { name: 'api', scope: 'tenant' },
      });
      expect(
        result.checkpoint && 'propsIncomplete' in result.checkpoint
          ? result.checkpoint.propsIncomplete
          : undefined,
      ).toBeUndefined();
      expect(result.owners.has('tenant/api')).toBe(false);
      expect(result.owners.get('account/api')).toBe('SomeoneElse');
    });
  }
  test('clears persisted precreate attributes before interrupted delete-first reconciliation', async () => {
    const result = await scenario({
      cycle: false,
      replace: true,
      read: true,
      fail: true,
      resume: true,
    });
    expect(Exit.isFailure(result.first)).toBe(true);
    expect(result.firstOutputs[0]).toBeUndefined();
    expect(
      result.checkpoint && 'attr' in result.checkpoint
        ? result.checkpoint.attr
        : undefined,
    ).toBeUndefined();
    expect(result.checkpoint).toMatchObject({
      props: { name: 'api', scope: 'tenant' },
      old: { instanceId: 'old' },
    });
    expect(result.owners.get('account/api')).toBe('SomeoneElse');
  });
});

for (const read of [false, true]) {
  test(`keeps a canonical physical precreate through retry (read=${read})`, async () => {
    const result = await scenario({
      cycle: true,
      replace: false,
      read,
      fail: true,
      retry: true,
      absent: true,
      outsideScope: true,
    });
    expect(result.first._tag).toBe('Failure');
    expect(result.retry?._tag).toBe('Success');
    expect(result.checkpoint).toMatchObject({
      props: { name: 'api', scope: 'tenant' },
      attr: attributes({ name: 'api', scope: 'tenant' }),
    });
    expect(new Map(result.ownersBeforeDestroy).get('tenant/api')).toBe(
      'Subject',
    );
    expect(result.owners.get('account/api')).toBe('SomeoneElse');
  });
}
test('recovers a physical precreate interrupted before returning attributes', async () => {
  const result = await scenario({
    cycle: true,
    replace: false,
    read: true,
    absent: true,
    outsideScope: true,
    precreateThrows: true,
  });
  expect(result.first._tag).toBe('Failure');
  expect(result.checkpoint).toMatchObject({
    props: { name: 'api', scope: 'tenant' },
  });
  expect(result.owners.has('tenant/api')).toBe(false);
  expect(result.owners.get('account/api')).toBe('SomeoneElse');
});

test('recovers an interrupted ordinary create from a fully evaluated whole-resource input', async () => {
  const result = await scenario({
    cycle: false,
    replace: false,
    wholeResource: true,
    read: true,
    absent: true,
    fail: true,
    writeBeforeFailure: true,
  });
  expect(Exit.isFailure(result.first)).toBe(true);
  expect(result.checkpoint).toMatchObject({
    props: { name: 'api', scope: 'tenant', source: { value: 'tenant' } },
  });
  expect(result.checkpoint).not.toHaveProperty('propsIncomplete', true);
  expect(result.ownersBeforeDestroy).toContainEqual(['tenant/api', 'Subject']);
  expect(result.owners.has('tenant/api')).toBe(false);
  expect(result.owners.get('account/api')).toBe('SomeoneElse');
});
