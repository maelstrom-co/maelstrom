import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  type ChartRequestMessage,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  ok,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { flushMicrotasks } from '../../../test-utils/async-utils.js';
import { createMockConnector } from '../../../test-utils/connector-mocks.js';
import {
  createMockEmptyResponse,
  createMockResponse,
} from '../../../test-utils/mocks.js';
import type { ActionResult } from '../command-processor/action-result.js';
import type { ApplicationSettlement } from '../connection-manager/application-settlement.js';
import { Orchestrator } from './orchestrator.js';
import type { OrchestratorOptions } from './orchestrator.types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('client-owned application acknowledgment', () => {
  let clock: ReturnType<typeof FakeTimers.install>;
  const clients: Orchestrator[] = [];
  beforeEach(() => {
    clock = FakeTimers.install();
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) await client.dispose();
    clock.uninstall();
  });

  async function setup() {
    const acknowledgment = deferred<void>();
    const sent: ChartRequestMessage[] = [];
    const responses: ReturnType<typeof deferred<MaelstromResponse>>[] = [];
    let signal: AbortSignal | undefined;
    const connector = createMockConnector({
      process: mock((request: ChartRequestMessage) => {
        sent.push(request);
        const response = deferred<MaelstromResponse>();
        responses.push(response);
        return response.promise;
      }),
    });
    Object.assign(connector, {
      applicationSettled: mock(
        (_value: ApplicationSettlement, cancellation?: AbortSignal) => {
          signal = cancellation;
          return acknowledgment.promise;
        },
      ),
    });
    const client = new Orchestrator(connector, {
      applicationAcknowledgmentTimeoutMs: 100,
      intentQueue: { activeTimeoutMs: 10_000, maxWaitMs: 10_000 },
    });
    clients.push(client);
    await client.connect();
    return {
      client,
      connector,
      acknowledgment,
      sent,
      responses,
      signal: () => signal,
    };
  }

  for (const ingress of ['queued', 'immediate', 'flush', 'timer'] as const) {
    it(`bounds ${ingress} acknowledgment without replaying an executed Action`, async () => {
      const h = await setup();
      const write = mock(() => ok(undefined));
      h.client.commandProcessor.registerRunner(InstanceId('active'), {
        show: write,
      });
      h.client.chartManager.setDimensions({ columns: 10, rows: 6 });
      const ticket =
        ingress === 'queued' ? h.client.enqueueIntent('write') : undefined;
      const immediate =
        ingress === 'immediate' ? h.client.processIntent('write') : undefined;
      const flush = ingress === 'flush' ? h.client.flushUpdates() : undefined;
      if (ingress === 'timer') await clock.tickAsync(350);
      else await flushMicrotasks();
      const response = createMockResponse(h.sent[0].id, 'active', 'show');
      h.responses[0].resolve(response);
      await flushMicrotasks();
      if (immediate) expect(await immediate).toBe(response);
      expect(write).toHaveBeenCalledTimes(1);
      expect(h.signal()?.aborted).toBe(false);
      const later = h.client.enqueueIntent('dependent write');
      h.client.chartManager.setDimensions({ columns: 11, rows: 6 });
      const bufferedFlush = h.client.flushUpdates();
      await clock.tickAsync(99);
      expect(h.signal()?.aborted).toBe(false);
      await clock.tickAsync(1);
      expect(h.signal()?.aborted).toBe(true);
      if (ticket) expect((await ticket.result).status).toBe('unknown');
      expect(await bufferedFlush).toBeNull();
      await flush;
      expect(h.client.intentScheduler.store.state.phase).toBe('idle');
      await expect(h.client.processIntent('retry')).rejects.toThrow(
        /acknowledgment/i,
      );
      expect(await h.client.flushUpdates()).toBeNull();
      h.acknowledgment.resolve();
      await clock.tickAsync(500);
      expect(h.sent).toHaveLength(1);
      expect(write).toHaveBeenCalledTimes(1);
      expect(later.store.state.status).toBe('queued');
      h.client.setConnector(h.connector);
      await expect(h.client.processIntent('same binding')).rejects.toThrow(
        /acknowledgment/i,
      );
      await clock.tickAsync(10_000);
      expect(await later.result).toEqual({
        status: 'not_submitted',
        reason: 'queue_expired',
      });
      expect(h.sent).toHaveLength(1);
    });
  }

  for (const retirement of ['replace', 'dispose'] as const) {
    it(`cancels a non-cooperating callback on ${retirement} and ignores its late rejection`, async () => {
      const h = await setup();
      const first = h.client.enqueueIntent('first');
      await flushMicrotasks();
      h.responses[0].resolve(createMockEmptyResponse(h.sent[0].id));
      await flushMicrotasks();
      const replacementResponse = deferred<MaelstromResponse>();
      const replacement = createMockConnector({
        process: mock(() => replacementResponse.promise),
      });
      if (retirement === 'replace') h.client.setConnector(replacement);
      else await h.client.dispose();
      expect(h.signal()?.aborted).toBe(true);
      expect((await first.result).status).toBe('unknown');
      await flushMicrotasks();
      expect(h.client.intentScheduler.store.state.phase).toBe('idle');
      if (retirement === 'replace') {
        await h.client.connect();
        const second = h.client.enqueueIntent('new binding');
        await flushMicrotasks();
        h.acknowledgment.reject(new Error('late retired failure'));
        await flushMicrotasks();
        expect(second.store.state.status).toBe('processing');
        expect(replacement.process).toHaveBeenCalledTimes(1);
        replacementResponse.resolve(createMockEmptyResponse(MessageId()));
        expect((await second.result).status).toBe('applied');
      } else {
        h.acknowledgment.reject(new Error('late disposed failure'));
        await flushMicrotasks();
        expect(clock.countTimers()).toBe(0);
      }
    });
  }

  it('keeps a rejected acknowledgment terminal until a new connector is installed', async () => {
    const h = await setup();
    const first = h.client.enqueueIntent('first');
    await flushMicrotasks();
    h.responses[0].resolve(createMockEmptyResponse(h.sent[0].id));
    await flushMicrotasks();
    h.acknowledgment.reject(new Error('acknowledgment lost'));
    expect((await first.result).status).toBe('unknown');
    await flushMicrotasks();
    expect(h.signal()?.aborted).toBe(true);
    await expect(h.client.processIntent('retry')).rejects.toThrow(
      'acknowledgment lost',
    );
    h.client.setConnector(
      createMockConnector({
        process: mock(async () => createMockEmptyResponse(MessageId())),
      }),
    );
    await h.client.connect();
    expect((await h.client.enqueueIntent('fresh request').result).status).toBe(
      'applied',
    );
    expect(h.sent).toHaveLength(1);
  });

  for (const value of [0, -1, Number.NaN, Infinity, 2 ** 31, '100', null]) {
    it(`rejects invalid acknowledgment bound ${String(value)} before connecting`, () => {
      const connector = createMockConnector();
      expect(
        () =>
          new Orchestrator(connector, {
            applicationAcknowledgmentTimeoutMs: value,
          } as OrchestratorOptions),
      ).toThrow(/applicationAcknowledgmentTimeoutMs/);
      expect(connector.connect).not.toHaveBeenCalled();
    });
  }

  it('starts the bound after Action settlement and clears it after successful acknowledgment', async () => {
    const h = await setup();
    const action = deferred<ActionResult>();
    h.client.commandProcessor.registerRunner(InstanceId('active'), {
      show: () => action.promise,
    });
    const first = h.client.enqueueIntent('slow Action');
    await flushMicrotasks();
    h.responses[0].resolve(createMockResponse(h.sent[0].id, 'active', 'show'));
    await clock.tickAsync(200);
    expect(h.signal()).toBeUndefined();
    expect(first.store.state.status).toBe('processing');
    action.resolve(ok(undefined));
    await flushMicrotasks();
    expect(h.signal()?.aborted).toBe(false);
    h.acknowledgment.resolve();
    expect((await first.result).status).toBe('applied');
    await clock.tickAsync(200);
    expect(h.signal()?.aborted).toBe(false);
    const second = h.client.enqueueIntent('next turn');
    await flushMicrotasks();
    expect(h.sent).toHaveLength(2);
    h.responses[1].resolve(createMockEmptyResponse(h.sent[1].id));
    expect((await second.result).status).toBe('applied');
  });

  it('does not resolve replacement flush waiters with the retired acknowledgment response', async () => {
    const h = await setup();
    h.client.chartManager.setDimensions({ columns: 10, rows: 6 });
    const first = h.client.flushUpdates();
    await flushMicrotasks();
    h.responses[0].resolve(createMockEmptyResponse(h.sent[0].id));
    await flushMicrotasks();
    h.client.chartManager.setDimensions({ columns: 11, rows: 6 });
    const nextResponse = deferred<MaelstromResponse>();
    h.client.setConnector(
      createMockConnector({ process: mock(() => nextResponse.promise) }),
    );
    let settled = false;
    const next = h.client.flushUpdates().then((response) => {
      settled = true;
      return response;
    });
    await h.client.connect();
    await flushMicrotasks();
    expect(await first).toBeNull();
    expect(settled).toBe(false);
    const response = createMockEmptyResponse(MessageId());
    nextResponse.resolve(response);
    expect(await next).toBe(response);
  });

  it('fences synchronous callback failure and retains the default finite budget', async () => {
    const h = await setup();
    Object.assign(h.connector, {
      applicationSettled: () => {
        throw new Error('acknowledgment failed synchronously');
      },
    });
    const ticket = h.client.enqueueIntent('first');
    await flushMicrotasks();
    h.responses[0].resolve(createMockEmptyResponse(h.sent[0].id));
    expect((await ticket.result).status).toBe('unknown');
    await expect(h.client.processIntent('retry')).rejects.toThrow(
      'acknowledgment failed synchronously',
    );
    const legacy = new Orchestrator(createMockConnector());
    clients.push(legacy);
    expect(legacy.getConfig().applicationAcknowledgmentTimeoutMs).toBe(60_000);
  });
});
