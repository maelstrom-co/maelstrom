import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  type ChartRequestMessage,
  err,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  ok,
  tilingLeafToken,
  VariantName,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { flushMicrotasks } from '../../../test-utils/async-utils.js';
import { createMockConnector } from '../../../test-utils/connector-mocks.js';
import {
  createMockEmptyResponse,
  createMockResponse,
} from '../../../test-utils/mocks.js';
import type { ActionResult } from '../command-processor/action-result.js';
import { ConnectorSupersededError } from './connector-superseded-error.js';
import { Orchestrator } from './orchestrator.js';
import type { OrchestratorOptions } from './orchestrator.types.js';
import { RequestInFlightError } from './request-in-flight-error.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('Orchestrator intent queue', () => {
  let clock: ReturnType<typeof FakeTimers.install>;
  const clients: Orchestrator[] = [];
  beforeEach(() => {
    clock = FakeTimers.install();
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) await client.dispose();
    clock.uninstall();
  });

  async function setup(options: OrchestratorOptions = {}) {
    const sent: ChartRequestMessage[] = [];
    const responses: ReturnType<typeof deferred<MaelstromResponse>>[] = [];
    const connector = createMockConnector({
      process: mock((request: ChartRequestMessage) => {
        sent.push(request);
        const response = deferred<MaelstromResponse>();
        responses.push(response);
        return response.promise;
      }),
    });
    const client = new Orchestrator(connector, options);
    clients.push(client);
    await client.connect();
    return { client, connector, sent, responses };
  }

  for (const ingress of ['queued', 'immediate', 'flush', 'timer'] as const) {
    for (const lifecycle of ['replace', 'dispose'] as const) {
      it(`fences ${ingress} response when applying notification triggers ${lifecycle}`, async () => {
        const { client, sent, responses } = await setup();
        const runner = mock(() => ok(undefined));
        const commands = mock(() => {});
        client.commandProcessor.registerRunner(InstanceId('stale'), {
          show: runner,
        });
        client.commandProcessor.events.on('command_start', commands);
        const mutation = {
          type: 'vessel_mutation' as const,
          instanceId: InstanceId('retained'),
          changes: 'keep automatic reason',
        };
        client.scheduleUpdate(mutation);
        client.chartManager.setDimensions({ columns: 10, rows: 6 });
        const recovered: ChartRequestMessage[] = [];
        const replacement = createMockConnector({
          process: mock(async (request: ChartRequestMessage) => {
            recovered.push(request);
            return createMockEmptyResponse(request.id);
          }),
        });
        let observed = false;
        let disposal: Promise<void> | undefined;
        const subscription = client.intentScheduler.store.subscribe(() => {
          if (
            observed ||
            client.intentScheduler.store.state.phase !== 'applying'
          )
            return;
          observed = true;
          if (lifecycle === 'replace') client.setConnector(replacement);
          else disposal = client.dispose();
        });
        const ticket =
          ingress === 'queued'
            ? client.enqueueIntent('do not replay')
            : undefined;
        const immediate =
          ingress === 'immediate'
            ? client.processIntent('do not replay').then(
                (response) => ({ response }),
                (error: unknown) => ({ error }),
              )
            : undefined;
        const flush = ingress === 'flush' ? client.flushUpdates() : undefined;
        if (ingress === 'timer') await clock.tickAsync(350);
        else await flushMicrotasks();
        expect(sent).toHaveLength(1);
        client.chartManager.setDimensions({ columns: 20, rows: 6 });
        const response = createMockResponse(sent[0].id, 'stale', 'show');
        responses[0].resolve(response);
        await flushMicrotasks();
        expect(observed).toBe(true);
        expect(client.commandProcessor.store.state.instances.size).toBe(0);
        expect(commands).not.toHaveBeenCalled();
        expect(runner).not.toHaveBeenCalled();
        if (ticket) expect((await ticket.result).status).toBe('unknown');
        if (immediate)
          expect(await immediate).toEqual(
            lifecycle === 'replace'
              ? { error: expect.any(ConnectorSupersededError) }
              : { response },
          );
        if (flush) expect(await flush).toBeNull();
        if (lifecycle === 'replace') {
          await client.flushUpdates();
          expect(recovered).toHaveLength(1);
          const retained = recovered[0].request.context.updateReasons;
          expect(retained).toContainEqual(mutation);
          expect(
            retained.filter((reason) => reason.type === 'chart_resize'),
          ).toEqual([
            {
              type: 'chart_resize',
              previous: { columns: 10, rows: 6 },
              current: { columns: 20, rows: 6 },
            },
          ]);
          expect(retained.some((reason) => reason.type === 'user_intent')).toBe(
            false,
          );
        }
        await disposal;
        subscription.unsubscribe();
      });
    }
  }

  it('rechecks queued ticket liveness after applying notification expires its deadline', async () => {
    const { client, sent, responses } = await setup({
      intentQueue: { activeTimeoutMs: 50 },
    });
    const commands = mock(() => {});
    client.commandProcessor.events.on('command_start', commands);
    let observed = false;
    const subscription = client.intentScheduler.store.subscribe(() => {
      if (observed || client.intentScheduler.store.state.phase !== 'applying')
        return;
      observed = true;
      clock.tick(50);
    });
    const ticket = client.enqueueIntent('expired before application');
    await flushMicrotasks();
    responses[0].resolve(createMockResponse(sent[0].id, 'stale', 'show'));
    await flushMicrotasks();
    expect(observed).toBe(true);
    expect((await ticket.result).status).toBe('unknown');
    expect(client.commandProcessor.store.state.instances.size).toBe(0);
    expect(commands).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  for (const retainMutation of [false, true]) {
    it(`settles disconnected flushes behind local commands without reconnect (mutation: ${retainMutation})`, async () => {
      const { client, sent, responses } = await setup();
      const action = deferred<ActionResult>();
      client.commandProcessor.registerRunner(InstanceId('local'), {
        show: () => action.promise,
      });
      client.commandProcessor.executeActions(
        createMockResponse(MessageId('local'), 'local', 'show').executionPlan,
      );
      client.chartManager.setDimensions({ columns: 10, rows: 6 });
      const mutation = {
        type: 'vessel_mutation' as const,
        instanceId: InstanceId('local'),
        changes: 'replay once',
      };
      if (retainMutation) client.scheduleUpdate(mutation);
      const completed: Array<MaelstromResponse | null> = [];
      void client.flushUpdates().then((response) => {
        completed.push(response);
      });
      void client.flushUpdates().then((response) => {
        completed.push(response);
      });
      await flushMicrotasks();
      expect(sent).toHaveLength(0);
      expect(completed).toEqual([]);
      await client.disconnect();
      action.resolve(ok(undefined));
      await flushMicrotasks();
      await clock.tickAsync(1000);
      expect(sent).toHaveLength(0);
      expect(completed).toEqual([null, null]);
      if (retainMutation) {
        await client.connect();
        await clock.tickAsync(350);
        expect(sent).toHaveLength(1);
        expect(
          sent[0].request.context.updateReasons.filter(
            (reason) => reason.type === 'vessel_mutation',
          ),
        ).toEqual([mutation]);
        responses[0].resolve(createMockEmptyResponse(sent[0].id));
        await clock.tickAsync(1000);
        expect(sent).toHaveLength(1);
        expect(completed).toEqual([null, null]);
      }
    });
  }

  for (const ingress of ['queued', 'immediate', 'automatic'] as const) {
    for (const phase of ['sending', 'applying'] as const) {
      it(`disconnect settles ${ingress} flush waiters by response ownership while ${phase}`, async () => {
        const { client, sent, responses } = await setup();
        const action = deferred<ActionResult>();
        client.commandProcessor.registerRunner(InstanceId('active'), {
          show: () => action.promise,
        });
        client.chartManager.setDimensions({ columns: 10, rows: 6 });
        const ticket =
          ingress === 'queued' ? client.enqueueIntent('active') : undefined;
        const immediate =
          ingress === 'immediate' ? client.processIntent('active') : undefined;
        const automatic =
          ingress === 'automatic' ? client.flushUpdates() : undefined;
        await flushMicrotasks();
        const response = createMockResponse(sent[0].id, 'active', 'show');
        if (phase === 'applying') {
          responses[0].resolve(response);
          await flushMicrotasks();
          if (immediate) expect(await immediate).toBe(response);
        }
        expect(client.intentScheduler.store.state.phase).toBe(phase);
        client.chartManager.setDimensions({ columns: 20, rows: 6 });
        const mutation = {
          type: 'vessel_mutation' as const,
          instanceId: InstanceId('active'),
          changes: 'retained after response',
        };
        client.scheduleUpdate(mutation);
        const completed: Array<MaelstromResponse | null> = [];
        const flush = client.flushUpdates();
        void flush.then((value) => {
          completed.push(value);
        });
        const unsent = ingress === 'immediate' && phase === 'applying';
        await client.disconnect();
        await flushMicrotasks();
        if (!unsent) expect(completed).toEqual([]);
        if (phase === 'sending') responses[0].resolve(response);
        await flushMicrotasks();
        if (immediate && !unsent) expect(completed).toEqual([response]);
        else if (!unsent) expect(completed).toEqual([]);
        action.resolve(ok(undefined));
        await flushMicrotasks();
        await clock.tickAsync(1000);
        expect(completed).toEqual([unsent ? null : response]);
        expect(await flush).toBe(unsent ? null : response);
        if (ticket) expect((await ticket.result).status).toBe('applied');
        if (immediate) expect(await immediate).toBe(response);
        if (automatic) expect(await automatic).toBe(response);
        expect(sent).toHaveLength(1);
        if (unsent) {
          // Settlement above must not depend on reconnect or its response.
          await client.connect();
          await clock.tickAsync(350);
          expect(sent).toHaveLength(2);
          expect(
            sent[1].request.context.updateReasons.filter(
              (reason) => reason.type === 'vessel_mutation',
            ),
          ).toEqual([mutation]);
          expect(
            sent[1].request.context.updateReasons.some(
              (reason) => reason.type === 'user_intent',
            ),
          ).toBe(false);
          responses[1].resolve(createMockEmptyResponse(sent[1].id));
          await clock.tickAsync(1000);
          expect(completed).toEqual([null]);
          expect(sent).toHaveLength(2);
        }
      });
    }

    it(`connected ${ingress} application flushes retain their actual response and latest updates`, async () => {
      const { client, sent, responses } = await setup();
      const action = deferred<ActionResult>();
      client.commandProcessor.registerRunner(InstanceId('active'), {
        show: () => action.promise,
      });
      client.chartManager.setDimensions({ columns: 10, rows: 6 });
      const ticket =
        ingress === 'queued' ? client.enqueueIntent('active') : undefined;
      const immediate =
        ingress === 'immediate' ? client.processIntent('active') : undefined;
      const automatic =
        ingress === 'automatic' ? client.flushUpdates() : undefined;
      await flushMicrotasks();
      client.chartManager.setDimensions({ columns: 15, rows: 6 });
      const earlyCompleted: Array<MaelstromResponse | null> = [];
      const earlyFlush = client.flushUpdates();
      void earlyFlush.then((response) => {
        earlyCompleted.push(response);
      });
      const firstResponse = createMockResponse(sent[0].id, 'active', 'show');
      responses[0].resolve(firstResponse);
      await flushMicrotasks();
      if (immediate) expect(await immediate).toBe(firstResponse);
      expect(client.intentScheduler.store.state.phase).toBe('applying');
      expect(earlyCompleted).toEqual(immediate ? [firstResponse] : []);
      client.chartManager.setDimensions({ columns: 20, rows: 6 });
      client.chartManager.setDimensions({ columns: 30, rows: 6 });
      const completed: Array<MaelstromResponse | null> = [];
      const flush = client.flushUpdates();
      void flush.then((response) => {
        completed.push(response);
      });
      await clock.tickAsync(1000);
      expect(sent).toHaveLength(1);
      expect(completed).toEqual([]);
      action.resolve(ok(undefined));
      await flushMicrotasks();
      expect(sent).toHaveLength(2);
      expect(await earlyFlush).toBe(firstResponse);
      expect(earlyCompleted).toEqual([firstResponse]);
      expect(completed).toEqual(immediate ? [] : [firstResponse]);
      expect(sent[1].request.context.updateReasons).toEqual([
        {
          type: 'chart_resize',
          previous: { columns: 20, rows: 6 },
          current: { columns: 30, rows: 6 },
        },
      ]);
      const secondResponse = createMockEmptyResponse(sent[1].id, 'second turn');
      responses[1].resolve(secondResponse);
      expect(await flush).toBe(immediate ? secondResponse : firstResponse);
      if (ticket) expect((await ticket.result).status).toBe('applied');
      if (automatic) expect(await automatic).toBe(firstResponse);
      await clock.tickAsync(1000);
      expect(sent).toHaveLength(2);
      expect(completed).toEqual([immediate ? secondResponse : firstResponse]);
    });
  }

  it('clears immediate flush ownership before the next queued turn', async () => {
    const { client, sent, responses } = await setup();
    const immediate = client.processIntent('first');
    responses[0].resolve(createMockEmptyResponse(sent[0].id));
    await immediate;
    await flushMicrotasks();
    const ticket = client.enqueueIntent('second');
    await flushMicrotasks();
    client.chartManager.setDimensions({ columns: 10, rows: 6 });
    const completed: Array<MaelstromResponse | null> = [];
    const flush = client.flushUpdates();
    void flush.then((response) => {
      completed.push(response);
    });
    await client.disconnect();
    await flushMicrotasks();
    expect(completed).toEqual([]);
    const response = createMockEmptyResponse(sent[1].id);
    responses[1].resolve(response);
    expect(await flush).toBe(response);
    expect((await ticket.result).status).toBe('applied');
    expect(completed).toEqual([response]);
  });

  it('runs FIFO users next after a 3s resize and action settlement, carrying latest dimensions and mutations', async () => {
    const { client, sent, responses } = await setup();
    client.chartManager.setDimensions({ columns: 10, rows: 6 });
    await clock.tickAsync(350);
    expect(sent).toHaveLength(1);
    const action = deferred<ActionResult>();
    client.commandProcessor.registerRunner(InstanceId('instance-1'), {
      show: () => action.promise,
    });
    const typed = client.enqueueIntent('typed first');
    const scope = client.createIntentScope();
    const voice = scope.enqueueIntent('voice second');
    await expect(client.processIntent('bypass')).rejects.toBeInstanceOf(
      RequestInFlightError,
    );
    for (let width = 11; width <= 20; width++) {
      client.chartManager.setDimensions({ columns: width, rows: 6 });
      client.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('instance-1'),
        changes: `change-${width}`,
      });
      await clock.tickAsync(300);
    }
    expect(sent).toHaveLength(1);
    responses[0].resolve(createMockResponse(sent[0].id, 'instance-1', 'show'));
    await flushMicrotasks();
    expect(client.requestCoordinator.isProcessing).toBe(false);
    expect(client.intentScheduler.store.state.phase).toBe('applying');
    expect(typed.store.state.status).toBe('queued');
    expect(sent).toHaveLength(1);
    action.resolve(ok(undefined));
    await flushMicrotasks();
    expect(sent).toHaveLength(2);
    expect(typed.store.state.status).toBe('processing');
    const reasons = sent[1].request.context.updateReasons;
    expect(reasons.filter((reason) => reason.type === 'chart_resize')).toEqual([
      {
        type: 'chart_resize',
        current: { columns: 20, rows: 6 },
        previous: { columns: 19, rows: 6 },
      },
    ]);
    const mutation = reasons.find(
      (reason) => reason.type === 'vessel_mutation',
    );
    expect(mutation?.type === 'vessel_mutation' && mutation.changes).toContain(
      'change-11',
    );
    expect(mutation?.type === 'vessel_mutation' && mutation.changes).toContain(
      'change-20',
    );
    expect(reasons.at(-1)).toEqual({
      type: 'user_intent',
      intent: 'typed first',
    });
    expect(client.commandProcessor.store.state.layout).toEqual(
      sent[1].request.layout,
    );
    responses[1].resolve(createMockEmptyResponse(sent[1].id));
    await flushMicrotasks();
    expect((await typed.result).status).toBe('applied');
    expect(sent).toHaveLength(3);
    expect(sent[2].request.context.updateReasons).toEqual([
      { type: 'user_intent', intent: 'voice second' },
    ]);
    expect(sent[2].request.layout).toEqual(
      createMockEmptyResponse(sent[1].id).layout,
    );
    responses[2].resolve(createMockEmptyResponse(sent[2].id));
    expect((await voice.result).status).toBe('applied');
    await clock.tickAsync(1000);
    expect(sent).toHaveLength(3);
  });

  it('holds immediate admission through response settlement and admits reentrant tickets only once', async () => {
    const { client, sent, responses } = await setup();
    const action = deferred<ActionResult>();
    client.commandProcessor.registerRunner(InstanceId('instance-1'), {
      show: () => action.promise,
    });
    const immediate = client.processIntent('immediate');
    responses[0].resolve(createMockResponse(sent[0].id, 'instance-1', 'show'));
    await immediate;
    await expect(client.processIntent('busy')).rejects.toBeInstanceOf(
      RequestInFlightError,
    );
    const queued = client.enqueueIntent('queued');
    const tickets = [queued];
    let observedProcessing = false;
    queued.store.subscribe(() => {
      if (!observedProcessing && queued.store.state.status === 'processing') {
        observedProcessing = true;
        tickets.push(client.enqueueIntent('reentrant'));
      }
    });
    action.resolve(ok(undefined));
    await flushMicrotasks();
    expect(sent).toHaveLength(2);
    responses[1].resolve(createMockEmptyResponse(sent[1].id));
    await flushMicrotasks();
    expect(sent).toHaveLength(3);
    responses[2].resolve(createMockEmptyResponse(sent[2].id));
    expect(
      (await Promise.all(tickets.map((ticket) => ticket.result))).map(
        (result) => result.status,
      ),
    ).toEqual(['applied', 'applied']);
  });

  it('waits for already-active local command work before snapshotting without inheriting its failure', async () => {
    const { client, sent, responses } = await setup();
    const action = deferred<ActionResult>();
    client.commandProcessor.registerRunner(InstanceId('instance-1'), {
      show: () => action.promise,
    });
    client.commandProcessor.executeActions(
      createMockResponse(MessageId('local'), 'instance-1', 'show')
        .executionPlan,
    );
    const ticket = client.enqueueIntent('after local');
    await clock.tickAsync(2000);
    expect(sent).toHaveLength(0);
    action.resolve(err(new Error('unrelated failure')));
    await flushMicrotasks();
    expect(sent).toHaveLength(1);
    responses[0].resolve(createMockEmptyResponse(sent[0].id));
    expect((await ticket.result).status).toBe('applied');
  });

  it('builds queued requests from current variants, definitions and layout mode', async () => {
    const { client, sent, responses } = await setup();
    const action = deferred<ActionResult>();
    client.commandProcessor.registerRunner(InstanceId('instance-1'), {
      show: () => action.promise,
    });
    const response = createMockResponse(
      MessageId('local'),
      'instance-1',
      'show',
    );
    client.commandProcessor.dispatch(
      { kind: 'set_layout', layout: response.layout },
      { kind: 'execute_actions', executionPlan: response.executionPlan },
    );
    const ticket = client.enqueueIntent('current state');
    await flushMicrotasks();
    const definition = {
      id: 'vessel-1',
      name: 'Latest vessel',
      description: 'newly registered',
      defaultVariant: 'expanded',
      variants: {
        expanded: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    };
    expect(client.vesselManager.registerVessel(definition).valid).toBe(true);
    client.commandProcessor.setVariantIfCurrent(
      InstanceId('instance-1'),
      VariantName('default'),
      VariantName('expanded'),
    );
    client.setLayoutMode('grid');
    action.resolve(ok(undefined));
    await flushMicrotasks();
    expect(sent).toHaveLength(1);
    expect(sent[0].request.instances[0].variant).toBe(VariantName('expanded'));
    expect(sent[0].request.vessels[0].name).toBe('Latest vessel');
    expect(sent[0].request.context.layoutMode).toBe('grid');
    expect(sent[0].request.layout.type).toBe('grid');
    responses[0].resolve(createMockEmptyResponse(sent[0].id));
    expect((await ticket.result).status).toBe('applied');
  });

  it('bounds disconnected admission and resumes only live pending users', async () => {
    const { client, sent, responses } = await setup({
      intentQueue: { connectionGraceMs: 100 },
    });
    await client.disconnect();
    const resumed = client.enqueueIntent('resume');
    await clock.tickAsync(99);
    expect(sent).toHaveLength(0);
    await client.connect();
    await flushMicrotasks();
    expect(sent).toHaveLength(1);
    responses[0].resolve(createMockEmptyResponse(sent[0].id));
    expect((await resumed.result).status).toBe('applied');
    await client.disconnect();
    const expired = client.enqueueIntent('expired');
    await clock.tickAsync(100);
    expect(await expired.result).toEqual({
      status: 'not_submitted',
      reason: 'disconnected',
    });
    await client.connect();
    await flushMicrotasks();
    expect(sent).toHaveLength(1);
  });

  it('settles coalesced flush waiters at an active deadline without releasing the transport lock', async () => {
    const { client, sent, responses } = await setup({
      intentQueue: { activeTimeoutMs: 100 },
    });
    const active = client.enqueueIntent('blocked');
    await flushMicrotasks();
    client.scheduleUpdate({
      type: 'vessel_mutation',
      instanceId: InstanceId('one'),
      changes: 'retained',
    });
    const flush = client.flushUpdates();
    await clock.tickAsync(100);
    expect((await active.result).status).toBe('unknown');
    expect(await flush).toBeNull();
    expect(sent).toHaveLength(1);
    responses[0].resolve(createMockEmptyResponse(sent[0].id));
    await clock.tickAsync(350);
    expect(sent).toHaveLength(2);
    expect(sent[1].request.context.updateReasons).toEqual([
      {
        type: 'vessel_mutation',
        instanceId: InstanceId('one'),
        changes: 'retained',
      },
    ]);
    responses[1].resolve(createMockEmptyResponse(sent[1].id));
    await flushMicrotasks();
  });

  it('preserves transport error identity as unknown and never retries a user mutation', async () => {
    const { client, sent, responses } = await setup();
    const ticket = client.enqueueIntent('mutate once');
    await flushMicrotasks();
    const error = new Error('invalid API key');
    responses[0].reject(error);
    expect(await ticket.result).toEqual({ status: 'unknown', error });
    await clock.tickAsync(60_000);
    expect(sent).toHaveLength(1);
  });

  it('does not apply a late response or overlap sends after the active deadline', async () => {
    const { client, sent, responses } = await setup({
      intentQueue: { activeTimeoutMs: 2000, maxWaitMs: 3000 },
    });
    const active = client.enqueueIntent('active');
    await flushMicrotasks();
    const pending = client.enqueueIntent('pending');
    await clock.tickAsync(3000);
    expect((await active.result).status).toBe('unknown');
    expect(await pending.result).toEqual({
      status: 'not_submitted',
      reason: 'queue_expired',
    });
    expect(sent).toHaveLength(1);
    responses[0].resolve(
      createMockResponse(sent[0].id, 'late-instance', 'show'),
    );
    await flushMicrotasks();
    expect(client.commandProcessor.store.state.instances.size).toBe(0);
    expect(active.store.state.status).toBe('unknown');
  });

  it('distinguishes a first-layout refusal from action failure or skipped execution', async () => {
    const { client, responses, sent } = await setup({ readyTimeoutMs: 10 });
    const refused = client.enqueueIntent('refused');
    await flushMicrotasks();
    const invalid = createMockResponse(sent[0].id, 'instance-1', 'show');
    if (invalid.layout.type !== 'tiling')
      throw new Error('expected tiling fixture');
    responses[0].resolve({
      ...invalid,
      layout: {
        ...invalid.layout,
        tree: [
          'V',
          tilingLeafToken(InstanceId('instance-1')),
          tilingLeafToken(InstanceId('instance-1')),
        ],
      },
    });
    expect((await refused.result).status).toBe('failed');
    expect(client.commandProcessor.store.state.instances.size).toBe(0);
    const failed = client.enqueueIntent('failed action');
    client.commandProcessor.registerRunner(InstanceId('instance-1'), {
      show: () => err(new Error('action failed')),
    });
    await flushMicrotasks();
    responses[1].resolve(createMockResponse(sent[1].id, 'instance-1', 'show'));
    expect((await failed.result).status).toBe('unknown');
    const skipped = client.enqueueIntent('skipped');
    await flushMicrotasks();
    responses[2].resolve(createMockResponse(sent[2].id, 'missing', 'show'));
    await clock.tickAsync(10);
    expect((await skipped.result).status).toBe('unknown');
  });

  for (const lifecycle of ['dispose', 'replace'] as const) {
    it(`settles pending/active work on ${lifecycle} and fences late responses`, async () => {
      const { client, sent, responses } = await setup();
      const active = client.enqueueIntent('active');
      await flushMicrotasks();
      const pending = client.enqueueIntent('pending');
      if (lifecycle === 'dispose') await client.dispose();
      else client.setConnector(createMockConnector());
      expect((await active.result).status).toBe('unknown');
      expect(await pending.result).toEqual({
        status: 'not_submitted',
        reason: lifecycle === 'dispose' ? 'disposed' : 'connector_replaced',
      });
      responses[0].resolve(createMockResponse(sent[0].id, 'ghost', 'show'));
      await flushMicrotasks();
      expect(client.commandProcessor.store.state.instances.size).toBe(0);
      expect(active.store.state.status).toBe('unknown');
      expect(sent).toHaveLength(1);
    });
  }
});
