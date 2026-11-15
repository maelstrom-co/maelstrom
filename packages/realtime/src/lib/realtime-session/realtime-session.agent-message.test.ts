import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { IntentScope, UIStructuralSnapshot } from '@maelstrom-co/client';
import { SessionId, ToolCallId } from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import type {
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  ToolResult,
} from './provider-adapter.types.js';
import { RealtimeSession } from './realtime-session.js';
import type {
  AgentMessageOutcome,
  RealtimeInstance,
} from './realtime-session.types.js';
import type { SessionEvent } from './session-event-bus.js';

const sessionId = SessionId('voice-agent-message');
const SNAPSHOT_SUMMARY = 'Snapshot summary.';
const UNCONFIRMED_SUMMARY =
  'The application result could not be confirmed. Do not retry automatically.';

describe('RealtimeSession agent message submission', () => {
  let clock: ReturnType<typeof FakeTimers.install>;
  const cleanup: Array<() => Promise<void>> = [];
  beforeEach(() => {
    clock = FakeTimers.install();
  });
  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
    clock.uninstall();
  });

  async function setup() {
    const agentMessages: string[] = [];
    const outcomes: Array<ReturnType<typeof deferred<AgentMessageOutcome>>> =
      [];
    const legacyCalls = {
      createIntentScope: 0,
      enqueueIntent: 0,
      submitIntent: 0,
    };
    const scope = {
      enqueueIntent: () => {
        legacyCalls.enqueueIntent++;
        throw new Error('Agent bridge used the intent scope');
      },
      retire: () => {},
    } as unknown as IntentScope;
    const bridge: RealtimeInstance = {
      sendAgentMessage: (text) => {
        agentMessages.push(text);
        const outcome = deferred<AgentMessageOutcome>();
        outcomes.push(outcome);
        return outcome.promise;
      },
      createIntentScope: () => {
        legacyCalls.createIntentScope++;
        return scope;
      },
      submitIntent: async () => {
        legacyCalls.submitIntent++;
        throw new Error('Agent bridge used legacy admission');
      },
      waitForIdle: async () => {
        throw new Error('Agent bridge used global idle');
      },
      waitForIdleResult: async () => {
        throw new Error('Agent bridge used global idle result');
      },
      getStructuralSnapshot: () => emptySnapshot(),
      getCapabilitySnapshot: () => ({ vessels: [] }),
      onSettled: () => () => {},
      addAssistantMessageAcknowledged: async () => 'inserted',
      observeEngineConnection: (cb) => {
        cb(true);
        return () => {};
      },
    };
    const provider = adapter();
    const session = new RealtimeSession({
      sessionId,
      instance: bridge,
      adapter: provider.instance,
      summarize: () => SNAPSHOT_SUMMARY,
    });
    cleanup.push(() => session.dispose());
    const events: SessionEvent[] = [];
    session.events.subscribe((event) => events.push(event));
    await session.connect();
    return {
      session,
      provider,
      agentMessages,
      outcomes,
      legacyCalls,
      events,
      settle: async (outcome: AgentMessageOutcome, index = 0) => {
        expect(agentMessages.length).toBeGreaterThan(index);
        outcomes[index].resolve(outcome);
        await clock.tickAsync(0);
      },
    };
  }

  function updateEvents(events: SessionEvent[]) {
    return events.flatMap((event): Array<Record<string, unknown>> => {
      switch (event.type) {
        case 'timing':
          return [{ type: event.type, label: event.label, ms: event.ms }];
        case 'tool.result':
          return [{ type: event.type, ok: event.ok }];
        case 'tool.submitted':
          return [
            { type: event.type, intent: event.intent, retry: event.retry },
          ];
        case 'tool.queued':
        case 'tool.completed':
        case 'tool.failed':
        case 'tool.unconfirmed':
        case 'tool.not_submitted':
          return [
            { type: event.type, intent: event.intent, summary: event.summary },
          ];
        default:
          return [];
      }
    });
  }

  it('sends an update_ui intent once through sendAgentMessage and never through the scope or legacy admission', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(0);

    expect(state.agentMessages).toEqual(['show my last order']);
    expect(state.legacyCalls).toEqual({
      createIntentScope: 0,
      enqueueIntent: 0,
      submitIntent: 0,
    });
  });

  it('withholds the tool result until the outcome settles, publishing tool.submitted first', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);

    expect(state.provider.results).toHaveLength(0);
    expect(updateEvents(state.events)).toEqual([
      { type: 'tool.submitted', intent: 'show my last order', retry: false },
    ]);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => value.status),
    ).toEqual(['submitted']);

    await state.settle({ status: 'finished', ok: true, reply: 'Here it is.' });

    expect(state.provider.results).toHaveLength(1);
  });

  it('answers a successful run with its reply and the snapshot summary', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle({
      status: 'finished',
      ok: true,
      reply: '  Here is your last order.  ',
    });

    expect(state.provider.results).toEqual([
      {
        callId: ToolCallId('call-1'),
        result: {
          ok: true,
          summary: SNAPSHOT_SUMMARY,
          userMessage: 'Here is your last order.',
        },
      },
    ]);
    expect(updateEvents(state.events)).toEqual([
      { type: 'tool.submitted', intent: 'show my last order', retry: false },
      { type: 'timing', label: 'update_ui.render', ms: 250 },
      {
        type: 'tool.completed',
        intent: 'show my last order',
        summary: 'Here is your last order.',
      },
      { type: 'tool.result', ok: true },
    ]);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => value.status),
    ).toEqual(['completed']);
  });

  it('answers a successful run without a reply with the snapshot summary', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle({ status: 'finished', ok: true });

    expect(state.provider.results).toEqual([
      {
        callId: ToolCallId('call-1'),
        result: { ok: true, summary: SNAPSHOT_SUMMARY },
      },
    ]);
    expect(updateEvents(state.events)).toEqual([
      { type: 'tool.submitted', intent: 'show my last order', retry: false },
      { type: 'timing', label: 'update_ui.render', ms: 250 },
      {
        type: 'tool.completed',
        intent: 'show my last order',
        summary: SNAPSHOT_SUMMARY,
      },
      { type: 'tool.result', ok: true },
    ]);
  });

  it('answers a failed run as a failure carrying its error text', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle({
      status: 'finished',
      ok: false,
      error: 'The order service is unavailable.',
    });

    expect(state.provider.results).toEqual([
      {
        callId: ToolCallId('call-1'),
        result: { ok: false, summary: 'The order service is unavailable.' },
      },
    ]);
    expect(updateEvents(state.events)).toEqual([
      { type: 'tool.submitted', intent: 'show my last order', retry: false },
      { type: 'timing', label: 'update_ui.error', ms: 250 },
      {
        type: 'tool.failed',
        intent: 'show my last order',
        summary: 'The order service is unavailable.',
      },
      { type: 'tool.result', ok: false },
    ]);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => value.status),
    ).toEqual(['failed']);
  });

  it('answers a lost run as an unconfirmed failure and never sends it again', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle({ status: 'lost', reason: 'disconnected' });
    await clock.tickAsync(60_000);
    state.provider.emit({ type: 'speech_started' });
    await clock.tickAsync(60_000);

    expect(state.agentMessages).toEqual(['show my last order']);
    expect(state.provider.results).toEqual([
      {
        callId: ToolCallId('call-1'),
        result: { ok: false, summary: UNCONFIRMED_SUMMARY },
      },
    ]);
    expect(updateEvents(state.events)).toEqual([
      { type: 'tool.submitted', intent: 'show my last order', retry: false },
      { type: 'timing', label: 'update_ui.error', ms: 250 },
      {
        type: 'tool.unconfirmed',
        intent: 'show my last order',
        summary: UNCONFIRMED_SUMMARY,
      },
      { type: 'tool.result', ok: false },
    ]);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => value.status),
    ).toEqual(['unknown']);
  });

  it('answers a message that was not submitted as a failure carrying its error', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle({ status: 'not_submitted', error: 'not connected' });

    expect(state.agentMessages).toEqual(['show my last order']);
    expect(state.provider.results).toHaveLength(1);
    const [{ result }] = state.provider.results;
    expect(result).toMatchObject({ ok: false });
    expect((result as { summary: string }).summary).toContain('not connected');
    expect(updateEvents(state.events)).toMatchObject([
      { type: 'tool.submitted', intent: 'show my last order', retry: false },
      { type: 'timing', label: 'update_ui.error', ms: 250 },
      { type: 'tool.not_submitted', intent: 'show my last order' },
      { type: 'tool.result', ok: false },
    ]);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => value.status),
    ).toEqual(['not_submitted']);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function emptySnapshot(): UIStructuralSnapshot {
  return {
    instances: [],
    layout: null,
    layoutMode: 'tiling',
    chartDimensions: { columns: 0, rows: 0 },
  };
}

function adapter() {
  const handlers = new Set<(event: RealtimeAdapterEvent) => void>();
  const results: Array<{ callId: ToolCallId; result: ToolResult }> = [];
  const instance: RealtimeProviderAdapter = {
    observations: { subscribe: () => () => {} },
    connect: async () => {},
    disconnect: async () => {},
    getAudioStreams: () => ({}),
    injectGrounding: () => {},
    sendToolResult: async (callId, result) => {
      results.push({ callId, result });
    },
    on: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
  return {
    instance,
    results,
    emit: (event: RealtimeAdapterEvent) => {
      for (const handler of handlers) handler(event);
    },
    call: (id: string, intent: string) => {
      for (const handler of handlers)
        handler({
          type: 'tool_call',
          callId: ToolCallId(id),
          name: 'update_ui',
          argumentsJson: JSON.stringify({ intent }),
        });
    },
  };
}
