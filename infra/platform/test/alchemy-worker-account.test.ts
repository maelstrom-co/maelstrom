import { describe, expect, test } from 'bun:test';
import { AdoptPolicy } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Apply from 'alchemy/Apply';
import { CloudflareEnvironment } from 'alchemy/Cloudflare';
import * as Plan from 'alchemy/Plan';
import * as Provider from 'alchemy/Provider';
import { renamedFrom } from 'alchemy/Rename';
import { Resource } from 'alchemy/Resource';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { encodeState, inMemoryState, reviveState, State } from 'alchemy/State';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

const accountA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const accountB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
interface Worker
  extends Resource<
    'Cloudflare.Worker',
    { name: string },
    { workerName: string; accountId: string }
  > {}
const Worker = Resource<Worker>('Cloudflare.Worker');
interface Independent
  extends Resource<
    'Probe.Independent',
    Record<string, never>,
    { id: string }
  > {}
const Independent = Resource<Independent>('Probe.Independent');

async function scenario(options: {
  operation:
    | 'checkpoint'
    | 'retry'
    | 'destroy'
    | 'stale-apply'
    | 'stale-destroy'
    | 'stale-rename'
    | 'legacy'
    | 'chain';
  switchAccount?: boolean;
  attributed?: boolean;
}) {
  let activeAccount = accountA;
  let failReconcile = true;
  const existingAccounts = new Set([accountB]);
  const reads: string[] = [];
  const writes: string[] = [];
  const deletes: string[] = [];
  const checkpoints: unknown[] = [];
  const stateWrites: string[] = [];
  const stateDeletes: string[] = [];
  const stack = {
    name: 'AccountProbe',
    stage: 'probe',
    resources: {},
    bindings: {},
    actions: {},
  };
  const key = { stack: stack.name, stage: stack.stage, fqn: 'Website' };
  const recordedState = Layer.effect(
    State,
    Effect.gen(function* () {
      const backend = yield* yield* State;
      return Effect.succeed({
        ...backend,
        set: <V extends Parameters<typeof backend.set>[0]['value']>(
          request: Omit<Parameters<typeof backend.set>[0], 'value'> & {
            value: V;
          },
        ) =>
          Effect.sync(() => stateWrites.push(request.fqn)).pipe(
            Effect.andThen(backend.set(request)),
          ),
        delete: (request: Parameters<typeof backend.delete>[0]) =>
          Effect.sync(() => stateDeletes.push(request.fqn)).pipe(
            Effect.andThen(backend.delete(request)),
          ),
      });
    }),
  ).pipe(Layer.provide(inMemoryState()));
  const services = Layer.mergeAll(
    recordedState,
    Provider.succeed(Worker, {
      read: () =>
        Effect.sync(() => {
          reads.push(activeAccount);
          return existingAccounts.has(activeAccount)
            ? { workerName: 'existing-worker', accountId: activeAccount }
            : undefined;
        }),
      reconcile: () =>
        Effect.gen(function* () {
          writes.push(activeAccount);
          existingAccounts.add(activeAccount);
          const store = yield* yield* State;
          checkpoints.push(yield* store.get(key));
          if (failReconcile)
            return yield* Effect.fail(new Error('interrupted-after-upload'));
          return { workerName: 'existing-worker', accountId: activeAccount };
        }),
      delete: ({ output }) =>
        Effect.sync(() => {
          deletes.push(output.accountId);
        }),
    }),
    Layer.succeed(
      CloudflareEnvironment,
      Effect.sync(() => ({
        type: 'apiToken' as const,
        apiToken: Redacted.make('offline-token'),
        accountId: activeAccount,
        source: { type: 'env' as const },
      })),
    ),
    Layer.succeed(Stack, stack),
    Layer.succeed(Stage, 'probe'),
    Layer.succeed(AdoptPolicy, false),
    Layer.succeed(AlchemyContext, {
      dotAlchemy: '.alchemy',
      dev: false,
      adopt: false,
    }),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const declaration = Worker('Website', { name: 'existing-worker' });
      const worker = yield* options.operation === 'stale-rename'
        ? declaration.pipe(renamedFrom('Previous'))
        : declaration;
      const context = yield* Effect.context<
        Provider.Provider<Worker> | State | Stack | Stage
      >();
      const compiled = { ...stack, output: worker, services: context };
      const store = yield* yield* State;
      const base = {
        status: 'creating' as const,
        fqn: 'Website',
        logicalId: 'Website',
        instanceId: 'interrupted-worker',
        resourceType: 'Cloudflare.Worker',
        namespace: undefined,
        props: { name: 'existing-worker' },
        providerVersion: 0,
        bindings: [],
        downstream: [],
        workerIdentityResolved: true,
      };
      if (options.operation === 'legacy') {
        yield* store.set({
          ...key,
          value: {
            ...base,
            ...(options.attributed
              ? { attr: { workerName: 'existing-worker', accountId: accountA } }
              : {}),
          },
        });
      } else if (options.operation === 'chain') {
        yield* store.set({
          ...key,
          value: {
            ...base,
            status: 'replaced',
            deleteFirst: false,
            attr: { workerName: 'successor', accountId: accountB },
            old: { ...base, workerAccountId: accountA },
          },
        });
      } else if (options.operation === 'stale-rename') {
        existingAccounts.add(accountA);
        yield* store.set({
          ...key,
          fqn: 'Previous',
          value: {
            ...base,
            status: 'created',
            fqn: 'Previous',
            logicalId: 'Previous',
            workerAccountId: accountA,
            attr: { workerName: 'existing-worker', accountId: accountA },
          },
        });
      } else if (options.operation !== 'stale-apply') {
        const first = yield* Plan.make(compiled);
        yield* Effect.exit(Apply.apply(first));
      }
      const before = yield* store.get(key);
      const previousBefore = yield* store.get({ ...key, fqn: 'Previous' });
      if (before)
        yield* store.set({
          ...key,
          value: JSON.parse(JSON.stringify(encodeState(before)), reviveState),
        });
      reads.length = 0;
      writes.length = 0;
      deletes.length = 0;
      stateWrites.length = 0;
      stateDeletes.length = 0;
      failReconcile = false;
      const input =
        options.operation === 'destroy' || options.operation === 'stale-destroy'
          ? {
              ...stack,
              resources: {},
              bindings: {},
              output: undefined,
              services: context,
            }
          : compiled;
      let exit: Exit.Exit<unknown, unknown>;
      if (
        options.operation === 'stale-apply' ||
        options.operation === 'stale-destroy' ||
        options.operation === 'stale-rename'
      ) {
        const planned = yield* Plan.make(input);
        reads.length = 0;
        activeAccount = options.switchAccount ? accountB : accountA;
        exit = yield* Effect.exit(Apply.apply(planned));
      } else if (options.operation === 'checkpoint') {
        exit = Exit.succeed(undefined);
      } else {
        activeAccount = options.switchAccount ? accountB : accountA;
        exit = yield* Effect.exit(
          Effect.gen(function* () {
            const planned = yield* Plan.make(input);
            yield* Apply.apply(planned);
          }),
        );
      }
      return {
        before,
        after: yield* store.get(key),
        previousBefore,
        previousAfter: yield* store.get({ ...key, fqn: 'Previous' }),
        exit,
      };
    }).pipe(Effect.provide(services), Effect.scoped),
  );
  return {
    ...result,
    reads,
    writes,
    deletes,
    checkpoints,
    stateWrites,
    stateDeletes,
  };
}

const errorText = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '';

describe('Worker account identity across interrupted deployments', () => {
  test('a filtered independent plan does not inspect or require credentials for an unselected legacy Worker', async () => {
    const stack = {
      name: 'FilteredAccountProbe',
      stage: 'probe',
      resources: {},
      bindings: {},
      actions: {},
    };
    const services = Layer.mergeAll(
      inMemoryState(),
      Provider.succeed(Worker, {
        read: () => Effect.die('Unselected Worker read'),
        reconcile: () => Effect.die('Unselected Worker reconcile'),
        delete: () => Effect.die('Unselected Worker delete'),
      }),
      Provider.succeed(Independent, {
        reconcile: () => Effect.succeed({ id: 'independent' }),
        delete: () => Effect.void,
      }),
      Layer.succeed(Stack, stack),
      Layer.succeed(Stage, 'probe'),
      Layer.succeed(AlchemyContext, {
        dotAlchemy: '.alchemy',
        dev: false,
        adopt: false,
      }),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Worker('Website', { name: 'existing-worker' });
        const output = yield* Independent('Independent', {});
        const context = yield* Effect.context<
          | Provider.Provider<Worker>
          | Provider.Provider<Independent>
          | State
          | Stack
          | Stage
        >();
        const store = yield* yield* State;
        const key = { stack: stack.name, stage: stack.stage, fqn: 'Website' };
        const legacy = {
          status: 'creating' as const,
          fqn: 'Website',
          logicalId: 'Website',
          instanceId: 'legacy',
          resourceType: Worker.Type,
          namespace: undefined,
          providerVersion: 0,
          props: { name: 'existing-worker' },
          bindings: [],
          downstream: [],
        };
        yield* store.set({ ...key, value: legacy });
        const compiled = { ...stack, output, services: context };
        const plan = yield* Plan.make(compiled, { include: ['Independent'] });
        expect(Object.keys(plan.resources)).toEqual(['Independent']);
        yield* Apply.apply(plan);
        expect(yield* store.get(key)).toEqual(legacy);
      }).pipe(Effect.provide(services), Effect.scoped),
    );
  });
  test('records the account before reconciliation can upload a Worker', async () => {
    const result = await scenario({ operation: 'checkpoint' });
    expect(result.checkpoints[0]).toMatchObject({ workerAccountId: accountA });
    expect(result.before).toMatchObject({ workerAccountId: accountA });
  });

  test.each([
    'retry',
    'destroy',
    'stale-apply',
    'stale-destroy',
    'stale-rename',
    'chain',
  ] as const)('refuses %s in another account before reading or mutating a same-tagged Worker', async (operation) => {
    const result = await scenario({ operation, switchAccount: true });
    expect(errorText(result.exit)).toContain('WorkerAccountMismatch');
    expect(result.reads).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.deletes).toEqual([]);
    expect(result.stateWrites).toEqual([]);
    expect(result.stateDeletes).toEqual([]);
    expect(result.after).toEqual(result.before);
    expect(result.previousAfter).toEqual(result.previousBefore);
  });

  test('requires manual recovery when a legacy attribute-free checkpoint has no account', async () => {
    const result = await scenario({ operation: 'legacy' });
    expect(errorText(result.exit)).toContain('WorkerAccountMismatch');
    expect(result.reads).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.after).toEqual(result.before);
  });

  test('continues interrupted creation in the original account', async () => {
    const result = await scenario({ operation: 'retry' });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.reads).toEqual([accountA]);
    expect(result.after).toMatchObject({
      workerAccountId: accountA,
      attr: { accountId: accountA },
    });
  });

  test('accepts a legacy checkpoint whose attributes identify the original account', async () => {
    const result = await scenario({ operation: 'legacy', attributed: true });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.after).toMatchObject({ attr: { accountId: accountA } });
  });
});
