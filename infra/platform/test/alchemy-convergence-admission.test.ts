import { expect, test } from 'bun:test';

import { AdoptPolicy, Unowned, Unresolved } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Apply from 'alchemy/Apply';
import { isResolved, stripEffects } from 'alchemy/Diff';
import * as Plan from 'alchemy/Plan';
import * as Provider from 'alchemy/Provider';
import { Resource } from 'alchemy/Resource';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { inMemoryState, State } from 'alchemy/State';
import * as Cause from 'effect/Cause';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

interface Peer extends Resource<
  'Probe.ConvergencePeer',
  Record<string, never>,
  { name: string; scope: string; value: string },
  { subject: string }
> {}
const Peer = Resource<Peer>('Probe.ConvergencePeer');
interface Target extends Resource<
  'Probe.ConvergenceTarget',
  {
    name: string;
    scope: string;
    value: string;
    wiring?: Effect.Effect<void>;
  },
  { name: string; scope: string; physicalId: string },
  { self: string }
> {}
const Target = Resource<Target>('Probe.ConvergenceTarget');
const key = (value: { name: string; scope: string }) =>
  `${value.scope}/${value.name}`;
const attrs = (value: { name: string; scope: string }) => ({
  name: value.name,
  scope: value.scope,
  physicalId: key(value),
});
type Decision = 'replace' | 'update' | 'noop' | 'void' | 'missing';
async function scenario(options: {
  decision: Decision;
  phase?: 'create' | 'update' | 'resume' | 'dag' | 'replace';
  identity?: boolean;
  ownership?: boolean;
  effectWiring?: boolean;
  normalizeWiring?: boolean;
  firstPass?: boolean;
}) {
  const phase = options.phase ?? 'create';
  const identity = options.identity ?? true;
  const ownership = options.ownership ?? true;
  const owners = new Map([
    ['Y/B', 'Subject'],
    ['Y/A', 'SomeoneElse'],
  ]);
  const writes: string[] = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* Deferred.make<void>();
      const stack = Stack.of({
        name: 'ConvergenceAdmission',
        stage: 'probe',
        resources: {},
        bindings: {},
        actions: {},
      });
      const layers = Layer.mergeAll(
        inMemoryState(),
        Provider.succeed(Peer, {
          precreate: () =>
            Effect.succeed(
              options.firstPass
                ? { name: 'B', scope: 'Y', value: 'early' }
                : { name: 'A', scope: 'X', value: 'early' },
            ),
          reconcile: () =>
            phase === 'dag' || options.firstPass
              ? Effect.succeed({ name: 'B', scope: 'Y', value: 'final' })
              : Deferred.await(first).pipe(
                  Effect.as({ name: 'B', scope: 'Y', value: 'final' }),
                ),
          delete: () => Effect.void,
        }),
        Provider.succeed(Target, {
          diff:
            options.decision === 'missing'
              ? undefined
              : ({ news }) =>
                  Effect.sync(() => {
                    const compared = options.normalizeWiring
                      ? stripEffects(news)
                      : news;
                    if (!isResolved(compared))
                      return phase === 'replace'
                        ? { action: 'replace' as const }
                        : undefined;
                    const action = options.decision;
                    if (action === 'void' || action === 'missing') return;
                    return { action };
                  }),
          observe:
            ownership && !options.firstPass
              ? ({ id, news }) =>
                  Effect.sync(() => {
                    if (!isResolved(news.name) || !isResolved(news.scope))
                      return Unresolved;
                    const owner = owners.get(key(news));
                    return owner === undefined
                      ? undefined
                      : owner === id
                        ? attrs(news)
                        : Unowned(attrs(news));
                  })
              : undefined,
          read: ownership
            ? ({ id, olds, output }) =>
                Effect.sync(() => {
                  const value = output ?? olds;
                  const owner = owners.get(key(value));
                  return owner === undefined
                    ? undefined
                    : owner === id
                      ? attrs(value)
                      : Unowned(attrs(value));
                })
            : undefined,
          precreate: ({ id, news }) =>
            Effect.sync(() => {
              if (!isResolved(news.name) || !isResolved(news.scope)) {
                if (options.firstPass) {
                  owners.set('X/A', id);
                  return attrs({ name: 'A', scope: 'X' });
                }
                return { name: 'pending', scope: 'pending', physicalId: '' };
              }
              owners.set(key(news), id);
              return attrs(news);
            }),
          reconcile: ({ id, news, output }) =>
            Effect.gen(function* () {
              const target = {
                name: output?.name ?? news.name,
                scope: news.scope,
              };
              writes.push(key(target));
              owners.set(key(target), id);
              yield* Deferred.succeed(first, undefined);
              return attrs(target);
            }),
          delete: ({ output }) =>
            Effect.sync(() => {
              owners.delete(key(output));
            }),
        }),
      );
      return yield* Effect.gen(function* () {
        const peer = yield* Peer('Peer', {});
        const subject = yield* Target('Subject', {
          name: identity ? peer.name : 'A',
          scope: identity ? peer.scope : 'X',
          value: peer.value,
          ...(options.effectWiring ? { wiring: Effect.void } : {}),
        });
        if (phase !== 'dag') {
          yield* peer.bind('Subject', { subject: subject.name });
          yield* subject.bind('Self', { self: subject.name });
        }
        const context = yield* Effect.context<
          | Provider.Provider<Peer>
          | Provider.Provider<Target>
          | State
          | Stack
          | Stage
        >();
        const compiled = { ...stack, output: subject, services: context };
        const store = yield* yield* State;
        const stateKey = {
          stack: stack.name,
          stage: stack.stage,
          fqn: 'Subject',
        };
        if (phase !== 'create') {
          owners.set('X/A', 'Subject');
          yield* store.set({
            ...stateKey,
            value: {
              status: phase === 'resume' ? 'creating' : 'created',
              fqn: 'Subject',
              logicalId: 'Subject',
              namespace: undefined,
              instanceId: 'saved',
              resourceType: Target.Type,
              providerVersion: 0,
              props: { name: 'A', scope: 'X', value: 'early' },
              attr: attrs({ name: 'A', scope: 'X' }),
              bindings: [],
              downstream: [],
            },
          });
        }
        const plan = yield* Plan.make(compiled);
        const exit = yield* Effect.exit(Apply.apply(plan));
        const checkpoint = yield* store.get(stateKey);
        const beforeDestroy = new Map(owners);
        yield* Plan.destroy(compiled).pipe(Effect.flatMap(Apply.apply));
        return {
          exit,
          checkpoint,
          beforeDestroy,
          afterDestroy: owners,
          writes,
        };
      }).pipe(
        Effect.provide(layers),
        Effect.provideService(Stack, stack),
        Effect.provideService(Stage, 'probe'),
        Effect.provideService(AdoptPolicy, false),
        Effect.provideService(AlchemyContext, {
          dotAlchemy: '.alchemy',
          dev: false,
          adopt: false,
        }),
        Effect.scoped,
      );
    }),
  );
}
function failure(exit: Awaited<ReturnType<typeof scenario>>['exit']) {
  return exit._tag === 'Failure'
    ? exit.cause.reasons.find(Cause.isFailReason)?.error
    : undefined;
}
for (const phase of ['create', 'update', 'resume', 'dag'] as const) {
  test(`refuses immutable identity drift before an unchecked write (${phase})`, async () => {
    const result = await scenario({ phase, decision: 'replace' });
    expect(failure(result.exit)).toMatchObject({
      _tag: 'UnverifiableReplacement',
    });
    expect(result.beforeDestroy.get('Y/A')).toBe('SomeoneElse');
    expect(result.writes).not.toContain('Y/A');
    expect(result.checkpoint).toMatchObject({
      props: { name: 'A', scope: 'X' },
      attr: attrs({ name: 'A', scope: 'X' }),
    });
    expect(result.afterDestroy.has('X/A')).toBe(false);
  });
}
for (const decision of ['void', 'missing'] as const) {
  test(`requires a conclusive in-place decision for owned convergence (${decision})`, async () => {
    const result = await scenario({ decision });
    expect(failure(result.exit)).toMatchObject({
      _tag: 'UnverifiableReplacement',
    });
    expect(result.beforeDestroy.get('Y/A')).toBe('SomeoneElse');
  });
}
for (const decision of ['update', 'noop'] as const) {
  test(`allows mutable cycle configuration with an explicit ${decision} decision`, async () => {
    const result = await scenario({ decision, identity: false });
    expect(result.exit._tag).toBe('Success');
    expect(result.beforeDestroy.get('Y/A')).toBe('SomeoneElse');
    expect(result.checkpoint).toMatchObject({
      props: { name: 'A', scope: 'X', value: 'final' },
    });
  });
}
test('honors immutable replacement requirements even without ownership hooks', async () => {
  const result = await scenario({
    decision: 'replace',
    ownership: false,
    phase: 'update',
  });
  expect(failure(result.exit)).toMatchObject({
    _tag: 'UnverifiableReplacement',
  });
  expect(result.writes).not.toContain('Y/A');
});
test('refuses an inconclusive diff when runtime wiring survives evaluation', async () => {
  const result = await scenario({
    decision: 'update',
    identity: false,
    effectWiring: true,
    phase: 'update',
  });
  expect(failure(result.exit)).toMatchObject({
    _tag: 'UnverifiableReplacement',
  });
  expect(result.beforeDestroy.get('Y/A')).toBe('SomeoneElse');
});
test('supports an explicit mutable diff after the provider normalizes runtime wiring', async () => {
  const result = await scenario({
    decision: 'update',
    identity: false,
    effectWiring: true,
    normalizeWiring: true,
    phase: 'update',
  });
  expect(result.exit._tag).toBe('Success');
  expect(result.checkpoint).toMatchObject({ props: { value: 'final' } });
});
test('preserves unchecked legacy mutable convergence without ownership hooks', async () => {
  const result = await scenario({
    decision: 'missing',
    ownership: false,
    identity: false,
  });
  expect(result.exit._tag).toBe('Success');
  expect(result.checkpoint).toMatchObject({ props: { value: 'final' } });
});

for (const phase of ['create', 'replace'] as const) {
  test(`checks a fresh ${phase} precreate before its first reconciliation changes identity`, async () => {
    const result = await scenario({
      phase,
      decision: 'replace',
      firstPass: true,
    });
    expect(failure(result.exit)).toMatchObject({
      _tag: 'UnverifiableReplacement',
    });
    expect(result.writes).not.toContain('Y/A');
    expect(result.beforeDestroy.get('Y/A')).toBe('SomeoneElse');
    expect(result.afterDestroy.has('X/A')).toBe(false);
  });
}
