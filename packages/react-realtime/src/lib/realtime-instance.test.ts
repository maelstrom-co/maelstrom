import { describe, expect, test } from 'bun:test';

import { Orchestrator, type OrchestratorOptions } from '@maelstrom-co/client';
import {
  agentAcceptedEvent,
  agentErrorEvent,
  agentFinishedEvent,
  agentMessageEvent,
  createMockAgentConnector,
  type MockAgentConnector,
} from '@maelstrom-co/client/_testing';
import {
  ChangeId,
  type ChartRequestMessage,
  type MaelstromResponse,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';
import type {
  AgentMessageOutcome,
  RealtimeInstance,
} from '@maelstrom-co/realtime';
import FakeTimers from '@sinonjs/fake-timers';

import { createMockConnector } from './__tests__/mock-connector.js';
import { createRealtimeInstance } from './realtime-instance.js';

async function flush() {
  for (let count = 0; count < 20; count++) await Promise.resolve();
}

test('createRealtimeInstance shares FIFO admission and retires only its pending voice lifetime', async () => {
  const sent: ChartRequestMessage[] = [];
  const release: Array<(response: MaelstromResponse) => void> = [];
  const client = new Orchestrator(
    createMockConnector({
      process: (request) => {
        sent.push(request);
        return new Promise((resolve) => {
          release.push(resolve);
        });
      },
    }),
  );
  try {
    await client.connect();
    const instance = createRealtimeInstance(client);
    const scope = instance.createIntentScope?.();
    expect(scope).toBeDefined();
    if (!scope) throw new Error('missing scoped admission');
    const active = client.enqueueIntent('typed-active');
    await flush();
    const first = scope.enqueueIntent('voice-first');
    const typed = client.enqueueIntent('typed-second');
    const retired = scope.enqueueIntent('voice-retired');
    expect(first.store.state).toMatchObject({
      status: 'queued',
      queuePosition: 1,
    });
    expect(typed.store.state).toMatchObject({
      status: 'queued',
      queuePosition: 2,
    });
    expect(sent).toHaveLength(1);
    const finish = (index: number) =>
      release[index]({
        type: 'maelstrom_response',
        requestId: sent[index].id,
        userMessage: 'Applied',
        rationale: '',
        executionPlan: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      });
    finish(0);
    await active.result;
    await flush();
    expect(first.store.state.status).toBe('processing');
    scope.retire();
    expect(await retired.result).toEqual({
      status: 'not_submitted',
      reason: 'owner_retired',
    });
    finish(1);
    expect((await first.result).status).toBe('applied');
    await flush();
    expect(sent[2].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'typed-second',
    });
    finish(2);
    expect((await typed.result).status).toBe('applied');
    expect(sent).toHaveLength(3);
  } finally {
    await client.dispose();
  }
});

type SendAgentMessageOption = (
  orchestrator: Orchestrator,
  text: string,
) => Promise<MessageId>;

const runA = RunId('run-a');
const runB = RunId('run-b');
const staleWindowMs = 10_000;

describe('createRealtimeInstance sendAgentMessage', () => {
  test('is absent when the option is not set', async () => {
    await withAgentOrchestrator(async ({ orchestrator }) => {
      expect('sendAgentMessage' in createRealtimeInstance(orchestrator)).toBe(
        false,
      );
      expect(
        'sendAgentMessage' in createRealtimeInstance(orchestrator, {}),
      ).toBe(false);
    });
  });

  test('calls the option with the orchestrator and text, then resolves the reply of the accepted run', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = track(
        requireSendAgentMessage(instance)('show the board'),
      );
      await flush();
      expect(send.calls).toEqual([{ orchestrator, text: 'show the board' }]);
      const inputId = send.inputIds[0];
      expect(agent.inputs).toMatchObject([
        { type: 'utterance', inputId, text: 'show the board', source: 'voice' },
      ]);

      agent.emit(agentAcceptedEvent(inputId, runA));
      await flush();
      expect(outcome.settled).toBe(false);

      agent.emit(agentFinishedEvent(runA, { reply: 'Board is up' }));
      expect(await outcome.promise).toEqual({
        status: 'finished',
        ok: true,
        reply: 'Board is up',
      });
    });
  });

  test('links an accepted event that arrives before the option resolves', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const inputId = MessageId('input-early');
      const pending = deferred<MessageId>();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: () => pending.promise,
      });

      const outcome = track(
        requireSendAgentMessage(instance)('show the board'),
      );
      agent.emit(agentAcceptedEvent(inputId, runA));
      pending.resolve(inputId);
      await flush();
      expect(outcome.settled).toBe(false);

      agent.emit(agentFinishedEvent(runA, { reply: 'Board is up' }));
      expect(await outcome.promise).toEqual({
        status: 'finished',
        ok: true,
        reply: 'Board is up',
      });
    });
  });

  test('ignores finished events of other runs', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = track(
        requireSendAgentMessage(instance)('show the board'),
      );
      await flush();
      agent.emit(agentAcceptedEvent(send.inputIds[0], runA));
      agent.emit(agentFinishedEvent(runB, { reply: 'Other run' }));
      await flush();
      expect(outcome.settled).toBe(false);

      agent.emit(agentFinishedEvent(runA, { reply: 'Mine' }));
      expect(await outcome.promise).toEqual({
        status: 'finished',
        ok: true,
        reply: 'Mine',
      });
    });
  });

  test('resolves a failed run with its error', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = requireSendAgentMessage(instance)('show the board');
      await flush();
      agent.emit(agentAcceptedEvent(send.inputIds[0], runA));
      agent.emit(
        agentFinishedEvent(runA, {
          ok: false,
          reason: 'error',
          reply: undefined,
          error: 'planner crashed',
        }),
      );

      expect(await outcome).toEqual({
        status: 'finished',
        ok: false,
        error: 'planner crashed',
      });
    });
  });

  test('falls back to the finish reason when a failed run carries no error', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = requireSendAgentMessage(instance)('show the board');
      await flush();
      agent.emit(agentAcceptedEvent(send.inputIds[0], runA));
      agent.emit(
        agentFinishedEvent(runA, {
          ok: false,
          reason: 'budget',
          reply: undefined,
        }),
      );

      expect(await outcome).toEqual({
        status: 'finished',
        ok: false,
        error: 'budget',
      });
    });
  });

  test('resolves a noise input as finished without waiting for a finished event', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = requireSendAgentMessage(instance)('um');
      await flush();
      agent.emit(agentAcceptedEvent(send.inputIds[0], null));

      const settled = await outcome;
      expect(settled).toEqual({ status: 'finished', ok: true });
      expect(settled).not.toHaveProperty('reply');
    });
  });

  test('resolves lost when the accepted run goes stale', async () => {
    await withFakeClock(async (clock) => {
      await withAgentOrchestrator(
        async ({ orchestrator, agent }) => {
          const send = sendThroughOrchestrator();
          const instance = createRealtimeInstance(orchestrator, {
            sendAgentMessage: send.option,
          });

          const outcome = track(
            requireSendAgentMessage(instance)('show the board'),
          );
          await flush();
          agent.emit(agentAcceptedEvent(send.inputIds[0], runA));
          await clock.tickAsync(staleWindowMs - 1);
          expect(outcome.settled).toBe(false);

          await clock.tickAsync(1);
          expect(await outcome.promise).toEqual({
            status: 'lost',
            reason: 'stale_run',
          });
        },
        { agentRunStaleTimeoutMs: staleWindowMs },
      );
    });
  });

  test('resolves lost when the input goes stale before it is accepted', async () => {
    await withFakeClock(async (clock) => {
      await withAgentOrchestrator(
        async ({ orchestrator }) => {
          const send = sendThroughOrchestrator();
          const instance = createRealtimeInstance(orchestrator, {
            sendAgentMessage: send.option,
          });

          const outcome = requireSendAgentMessage(instance)('show the board');
          await flush();
          await clock.tickAsync(staleWindowMs);

          expect(await outcome).toEqual({
            status: 'lost',
            reason: 'stale_run',
          });
        },
        { agentRunStaleTimeoutMs: staleWindowMs },
      );
    });
  });

  test('ignores a stale run that is not its own', async () => {
    await withFakeClock(async (clock) => {
      await withAgentOrchestrator(
        async ({ orchestrator, agent }) => {
          const send = sendThroughOrchestrator();
          const instance = createRealtimeInstance(orchestrator, {
            sendAgentMessage: send.option,
          });

          const otherInputId = await orchestrator.sendMessage('typed request');
          agent.emit(agentAcceptedEvent(otherInputId, runB));
          // A run with its own activity is no longer re-armed by traffic of
          // other runs, so runB's window keeps running from here.
          agent.emit(agentMessageEvent(runB, 'other work'));
          const outcome = track(
            requireSendAgentMessage(instance)('show the board'),
          );
          await flush();
          agent.emit(agentAcceptedEvent(send.inputIds[0], runA));

          await clock.tickAsync(staleWindowMs - 1);
          agent.emit(agentMessageEvent(runA, 'still working'));
          await clock.tickAsync(1);
          await flush();
          expect(outcome.settled).toBe(false);

          agent.emit(agentFinishedEvent(runA, { reply: 'Mine' }));
          expect(await outcome.promise).toEqual({
            status: 'finished',
            ok: true,
            reply: 'Mine',
          });
        },
        { agentRunStaleTimeoutMs: staleWindowMs },
      );
    });
  });

  test('resolves lost when the connection drops while the run is open', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = requireSendAgentMessage(instance)('show the board');
      await flush();
      agent.emit(agentAcceptedEvent(send.inputIds[0], runA));
      agent.close({ clean: false });

      expect(await outcome).toEqual({ status: 'lost', reason: 'disconnected' });
    });
  });

  test('resolves lost when the connector is replaced while the input is open', async () => {
    await withAgentOrchestrator(async ({ orchestrator }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = requireSendAgentMessage(instance)('show the board');
      await flush();
      orchestrator.setConnector(createMockAgentConnector().connector);

      expect(await outcome).toEqual({
        status: 'lost',
        reason: 'connector_replaced',
      });
    });
  });

  test('resolves a failed outcome on an error for its input', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = requireSendAgentMessage(instance)('show the board');
      await flush();
      agent.emit(
        agentErrorEvent({
          inputId: send.inputIds[0],
          error: 'input rejected',
        }),
      );

      expect(await outcome).toEqual({
        status: 'finished',
        ok: false,
        error: 'input rejected',
      });
    });
  });

  test('keeps waiting through a run-scoped error of its run', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = track(
        requireSendAgentMessage(instance)('show the board'),
      );
      await flush();
      agent.emit(agentAcceptedEvent(send.inputIds[0], runA));
      agent.emit(
        agentErrorEvent({
          runId: runA,
          changeId: ChangeId('change-1'),
          error: 'loop change failed',
        }),
      );
      await flush();
      expect(outcome.settled).toBe(false);

      agent.emit(agentFinishedEvent(runA, { reply: 'Recovered' }));
      expect(await outcome.promise).toEqual({
        status: 'finished',
        ok: true,
        reply: 'Recovered',
      });
    });
  });

  test('resolves not_submitted when the option rejects', async () => {
    await withAgentOrchestrator(async ({ orchestrator }) => {
      const subscriptions = trackAgentSubscriptions(orchestrator);
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: () => Promise.reject(new Error('engine offline')),
      });

      expect(await requireSendAgentMessage(instance)('show the board')).toEqual(
        { status: 'not_submitted', error: 'engine offline' },
      );
      expect(subscriptions.active()).toBe(0);
    });
  });

  test('resolves not_submitted when the option throws synchronously', async () => {
    await withAgentOrchestrator(async ({ orchestrator }) => {
      const subscriptions = trackAgentSubscriptions(orchestrator);
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: () => {
          throw new Error('no session');
        },
      });

      expect(await requireSendAgentMessage(instance)('show the board')).toEqual(
        { status: 'not_submitted', error: 'no session' },
      );
      expect(subscriptions.active()).toBe(0);
    });
  });

  test('subscribes before calling the option and removes its listeners once settled', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const subscriptions = trackAgentSubscriptions(orchestrator);
      const send = sendThroughOrchestrator();
      let activeWhenCalled = 0;
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: (client: Orchestrator, text: string) => {
          activeWhenCalled = subscriptions.active();
          return send.option(client, text);
        },
      });

      const outcome = requireSendAgentMessage(instance)('show the board');
      await flush();
      expect(activeWhenCalled).toBeGreaterThan(0);
      expect(subscriptions.active()).toBeGreaterThan(0);

      agent.emit(agentAcceptedEvent(send.inputIds[0], runA));
      agent.emit(agentFinishedEvent(runA, { reply: 'Board is up' }));
      expect(await outcome).toEqual({
        status: 'finished',
        ok: true,
        reply: 'Board is up',
      });
      expect(subscriptions.active()).toBe(0);

      agent.emit(agentFinishedEvent(runA, { ok: false, reason: 'error' }));
      agent.close({ clean: false });
      expect(subscriptions.active()).toBe(0);
    });
  });
});

async function withAgentOrchestrator(
  body: (context: {
    orchestrator: Orchestrator;
    agent: MockAgentConnector;
  }) => Promise<void>,
  options: OrchestratorOptions = {},
): Promise<void> {
  const agent = createMockAgentConnector();
  const orchestrator = new Orchestrator(agent.connector, options);
  try {
    await orchestrator.connect();
    await body({ orchestrator, agent });
  } finally {
    await orchestrator.dispose();
  }
}

async function withFakeClock(
  body: (clock: ReturnType<typeof FakeTimers.install>) => Promise<void>,
): Promise<void> {
  const clock = FakeTimers.install({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
    ],
  });
  try {
    await body(clock);
  } finally {
    clock.uninstall();
  }
}

function sendThroughOrchestrator(): {
  option: SendAgentMessageOption;
  calls: Array<{ orchestrator: Orchestrator; text: string }>;
  inputIds: MessageId[];
} {
  const calls: Array<{ orchestrator: Orchestrator; text: string }> = [];
  const inputIds: MessageId[] = [];
  return {
    calls,
    inputIds,
    option: async (orchestrator, text) => {
      calls.push({ orchestrator, text });
      const inputId = await orchestrator.sendMessage(text, { source: 'voice' });
      inputIds.push(inputId);
      return inputId;
    },
  };
}

function requireSendAgentMessage(
  instance: RealtimeInstance,
): (text: string) => Promise<AgentMessageOutcome> {
  const send = instance.sendAgentMessage;
  if (!send) throw new Error('instance has no sendAgentMessage');
  return (text) => send.call(instance, text);
}

function track<T>(promise: Promise<T>): {
  promise: Promise<T>;
  readonly settled: boolean;
} {
  let settled = false;
  const tracked = promise.finally(() => {
    settled = true;
  });
  return {
    promise: tracked,
    get settled() {
      return settled;
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function trackAgentSubscriptions(orchestrator: Orchestrator): {
  active: () => number;
} {
  const events = orchestrator.agent;
  const active = new Set<{ event: string; callback: unknown }>();
  const on = events.on.bind(events);
  const off = events.off.bind(events);
  const remove = (event: string, callback: unknown) => {
    for (const entry of active) {
      if (entry.event === event && entry.callback === callback) {
        active.delete(entry);
        return;
      }
    }
  };
  events.on = ((event: string, callback: never) => {
    const entry = { event, callback };
    active.add(entry);
    const unsubscribe = on(event as never, callback);
    return () => {
      active.delete(entry);
      unsubscribe();
    };
  }) as typeof events.on;
  events.off = ((event: string, callback: never) => {
    remove(event, callback);
    off(event as never, callback);
  }) as typeof events.off;
  return { active: () => active.size };
}
