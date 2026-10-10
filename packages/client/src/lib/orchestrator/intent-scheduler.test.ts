import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';
import { flushMicrotasks } from '../../../test-utils/async-utils.js';
import { IntentScheduler } from './intent-scheduler.js';
import type {
  IntentQueueOptions,
  IntentResult,
} from './intent-scheduler.types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const refused: IntentResult = { status: 'failed', error: new Error('refused') };

describe('IntentScheduler', () => {
  let clock: ReturnType<typeof FakeTimers.install>;
  const schedulers: IntentScheduler[] = [];
  beforeEach(() => {
    clock = FakeTimers.install();
  });
  afterEach(() => {
    for (const scheduler of schedulers.splice(0)) scheduler.retire('disposed');
    clock.uninstall();
  });

  function setup(policy: IntentQueueOptions = {}) {
    const turns: ReturnType<typeof deferred<IntentResult>>[] = [];
    const run = mock((_intent: string, _live: () => boolean) => {
      const turn = deferred<IntentResult>();
      turns.push(turn);
      return turn.promise;
    });
    const automatic = mock(() => {});
    const scheduler = new IntentScheduler(policy, {
      ready: () => true,
      run,
      automatic,
    });
    schedulers.push(scheduler);
    scheduler.setConnected(true);
    return { scheduler, run, turns, automatic };
  }

  it('shares FIFO scopes, rejects full admission and does not let immediate work bypass users', async () => {
    const { scheduler, turns, run } = setup({ capacity: 2 });
    expect(scheduler.acquire()).toBe(true);
    const voice = scheduler.createScope();
    const typed = scheduler.enqueue('typed');
    const spoken = voice.enqueueIntent('voice');
    const full = scheduler.enqueue('full');
    expect(full.accepted).toBe(false);
    expect(await full.result).toEqual({
      status: 'not_submitted',
      reason: 'queue_full',
    });
    expect(spoken.store.state).toEqual({ status: 'queued', queuePosition: 2 });
    scheduler.release();
    expect(scheduler.acquire()).toBe(false);
    await flushMicrotasks();
    expect(run.mock.calls[0]?.[0]).toBe('typed');
    turns[0].resolve(refused);
    await flushMicrotasks();
    expect(await typed.result).toBe(refused);
    expect(run.mock.calls[1]?.[0]).toBe('voice');
    turns[1].resolve(refused);
    expect(await spoken.result).toBe(refused);
    await flushMicrotasks();
    expect(scheduler.store.state.pendingCount).toBe(0);
    expect(clock.countTimers()).toBe(0);
  });

  it('retires only an owner pending at a reentrant dispatch boundary', async () => {
    const { scheduler, turns, run } = setup();
    const owner = scheduler.createScope();
    const active = owner.enqueueIntent('active');
    const retired = owner.enqueueIntent('retired');
    const typed = scheduler.enqueue('typed');
    active.store.subscribe(() => {
      if (active.store.state.status === 'processing') owner.retire();
    });
    await flushMicrotasks();
    expect(await retired.result).toEqual({
      status: 'not_submitted',
      reason: 'owner_retired',
    });
    expect(await owner.enqueueIntent('late').result).toEqual({
      status: 'not_submitted',
      reason: 'owner_retired',
    });
    expect(active.store.state.status).toBe('processing');
    owner.retire();
    turns[0].resolve(refused);
    await flushMicrotasks();
    expect(await active.result).toBe(refused);
    expect(run.mock.calls.map((call) => call[0])).toEqual(['active', 'typed']);
    turns[1].resolve(refused);
    expect(await typed.result).toBe(refused);
  });

  it('expires pending work while an unresolved active turn retains the lock after its deadline', async () => {
    const { scheduler, turns, run } = setup({
      maxWaitMs: 100,
      activeTimeoutMs: 50,
    });
    const active = scheduler.enqueue('active');
    await flushMicrotasks();
    const pending = scheduler.enqueue('pending');
    let terminalCount = 0;
    active.store.subscribe(() => {
      if (active.store.state.status === 'unknown') terminalCount++;
    });
    await clock.tickAsync(50);
    expect((await active.result).status).toBe('unknown');
    expect(scheduler.acquire()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    await clock.tickAsync(50);
    expect(await pending.result).toEqual({
      status: 'not_submitted',
      reason: 'queue_expired',
    });
    expect(clock.countTimers()).toBe(0);
    turns[0].resolve(refused);
    await flushMicrotasks();
    expect(terminalCount).toBe(1);
    expect(active.store.state.status).toBe('unknown');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retires a middle pending entry without losing live entries on either side', async () => {
    const { scheduler, turns, run } = setup({
      connectionGraceMs: 20,
      maxWaitMs: 100,
    });
    scheduler.acquire();
    const first = scheduler.enqueue('first');
    const owner = scheduler.createScope();
    const middle = owner.enqueueIntent('middle');
    const last = scheduler.enqueue('last');
    owner.retire();
    expect((await middle.result).status).toBe('not_submitted');
    expect(last.store.state).toEqual({ status: 'queued', queuePosition: 2 });
    scheduler.release();
    await flushMicrotasks();
    turns[0].resolve(refused);
    await flushMicrotasks();
    turns[1].resolve(refused);
    await Promise.all([first.result, last.result]);
    expect(run.mock.calls.map((call) => call[0])).toEqual(['first', 'last']);
  });

  it('reconnects inside grace but never resurrects disconnected or queue-expired tickets', async () => {
    const { scheduler, turns, run } = setup({
      connectionGraceMs: 20,
      maxWaitMs: 30,
    });
    scheduler.setConnected(false);
    const resumed = scheduler.enqueue('resumed');
    await clock.tickAsync(19);
    expect(run).not.toHaveBeenCalled();
    scheduler.setConnected(true);
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(1);
    turns[0].resolve(refused);
    await resumed.result;
    scheduler.setConnected(false);
    const lost = scheduler.enqueue('lost');
    await clock.tickAsync(20);
    expect(await lost.result).toEqual({
      status: 'not_submitted',
      reason: 'disconnected',
    });
    scheduler.setConnected(true);
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.acquire();
    const old = scheduler.enqueue('old');
    await clock.tickAsync(25);
    scheduler.setConnected(false);
    await clock.tickAsync(5);
    expect(await old.result).toEqual({
      status: 'not_submitted',
      reason: 'queue_expired',
    });
    scheduler.release();
  });

  for (const reason of ['disposed', 'connector_replaced'] as const) {
    it(`settles active and pending tickets once on ${reason}`, async () => {
      const { scheduler, turns } = setup();
      const active = scheduler.enqueue('active');
      await flushMicrotasks();
      const pending = scheduler.enqueue('pending');
      scheduler.retire(reason);
      expect((await active.result).status).toBe('unknown');
      expect(await pending.result).toEqual({ status: 'not_submitted', reason });
      expect(clock.countTimers()).toBe(0);
      turns[0].resolve(refused);
      await flushMicrotasks();
      expect(active.store.state.status).toBe('unknown');
      if (reason === 'disposed')
        expect(await scheduler.enqueue('late').result).toEqual({
          status: 'not_submitted',
          reason,
        });
    });
  }

  it('validates finite bounded policy and foreign scopes', () => {
    for (const policy of [
      { capacity: 0 },
      { capacity: 1.5 },
      { maxWaitMs: NaN },
      { connectionGraceMs: Infinity },
      { activeTimeoutMs: 2 ** 31 },
    ]) {
      expect(() => setup(policy)).toThrow('intentQueue.');
    }
    const first = setup().scheduler;
    const second = setup().scheduler;
    expect(() =>
      first.enqueue('foreign', { scope: second.createScope() }),
    ).toThrow('another Orchestrator');
  });
});
