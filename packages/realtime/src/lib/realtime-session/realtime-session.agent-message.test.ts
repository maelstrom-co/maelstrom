import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import type {
  AgentRunLostReason,
  IntentScope,
  SettledAgentRun,
  UIStructuralSnapshot,
} from '@maelstrom-co/client';
import {
  type AgentDisposition,
  MessageId,
  RunId,
  SessionId,
  ToolCallId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import type {
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  ToolResult,
} from './provider-adapter.types.js';
import { RealtimeSession } from './realtime-session.js';
import type { RealtimeInstance } from './realtime-session.types.js';
import type { SessionEvent } from './session-event-bus.js';

const sessionId = SessionId('voice-agent-message');
const SNAPSHOT_SUMMARY = 'Snapshot summary.';
const UNCONFIRMED_SUMMARY =
  'The application result could not be confirmed. Do not retry automatically.';
const AGENT_RUN_FINISHED_SUMMARY =
  'The request was handled. The screen may still be updating.';
const AGENT_INPUT_IGNORED_SUMMARY =
  'The request was not acted on, so nothing on the screen changed.';

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

  async function setup(
    options: {
      sendAgentMessage?: (text: string) => Promise<SettledAgentRun>;
    } = {},
  ) {
    const agentMessages: string[] = [];
    const reads = { snapshot: 0, summarize: 0 };
    const outcomes: Array<ReturnType<typeof deferred<SettledAgentRun>>> = [];
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
        if (options.sendAgentMessage) return options.sendAgentMessage(text);
        const outcome = deferred<SettledAgentRun>();
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
      getStructuralSnapshot: () => {
        reads.snapshot++;
        return emptySnapshot();
      },
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
      summarize: () => {
        reads.summarize++;
        return SNAPSHOT_SUMMARY;
      },
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
      reads,
      settle: async (outcome: SettledAgentRun, index = 0) => {
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

  it('sends an submit_intent intent once through sendAgentMessage and never through the scope or legacy admission', async () => {
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

    await state.settle(finishedRun('Here it is.'));

    expect(state.provider.results).toHaveLength(1);
  });

  it('answers a finished agent run with its reply only and records it as unconfirmed, without reading the screen', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle(finishedRun('  Here is your last order.  '));

    expect(state.provider.results).toEqual([
      {
        callId: ToolCallId('call-1'),
        result: { ok: true, userMessage: 'Here is your last order.' },
      },
    ]);
    expect(updateEvents(state.events)).toEqual([
      { type: 'tool.submitted', intent: 'show my last order', retry: false },
      { type: 'timing', label: 'update_ui.agent_run', ms: 250 },
      {
        type: 'tool.unconfirmed',
        intent: 'show my last order',
        summary: 'Here is your last order.',
      },
      { type: 'tool.result', ok: true },
    ]);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => value.status),
    ).toEqual(['unknown']);
    expect(state.reads).toEqual({ snapshot: 0, summarize: 0 });
  });

  for (const [name, reply] of [
    ['without a reply', ''],
    ['with a blank reply', '   '],
  ] as const) {
    it(`answers a successful run ${name} with the fixed handled sentence, recorded as unconfirmed`, async () => {
      const state = await setup();

      state.provider.call('call-1', 'show my last order');
      await clock.tickAsync(250);
      await state.settle(finishedRun(reply ?? ''));

      expect(state.provider.results).toEqual([
        {
          callId: ToolCallId('call-1'),
          result: { ok: true, summary: AGENT_RUN_FINISHED_SUMMARY },
        },
      ]);
      expect(updateEvents(state.events)).toEqual([
        { type: 'tool.submitted', intent: 'show my last order', retry: false },
        { type: 'timing', label: 'update_ui.agent_run', ms: 250 },
        {
          type: 'tool.unconfirmed',
          intent: 'show my last order',
          summary: AGENT_RUN_FINISHED_SUMMARY,
        },
        { type: 'tool.result', ok: true },
      ]);
      expect(
        state.session.memory
          .getSnapshot()
          .outcomes.map((value) => value.status),
      ).toEqual(['unknown']);
      expect(state.reads).toEqual({ snapshot: 0, summarize: 0 });
    });
  }

  it('answers a finished UI-only run with the screen summary and its reply, recorded as completed', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle(finishedRun('  Here is your last order.  ', 'ui_only'));

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
      { type: 'timing', label: 'update_ui.agent_run', ms: 250 },
      {
        type: 'tool.completed',
        intent: 'show my last order',
        summary: 'Here is your last order.',
      },
      { type: 'tool.result', ok: true },
    ]);
    expect(state.reads).toEqual({ snapshot: 1, summarize: 1 });
  });

  it('answers a finished UI-only run whose change was refused as a failure carrying the change error, without reading the screen', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle({
      ...finishedRun('Here is your last order.', 'ui_only'),
      changeErrors: [
        { changeId: null, message: '  The order vessel is unavailable.  ' },
      ],
    });

    expect(state.provider.results).toEqual([
      {
        callId: ToolCallId('call-1'),
        result: { ok: false, summary: 'The order vessel is unavailable.' },
      },
    ]);
    expect(updateEvents(state.events)).toEqual([
      { type: 'tool.submitted', intent: 'show my last order', retry: false },
      { type: 'timing', label: 'update_ui.error', ms: 250 },
      {
        type: 'tool.failed',
        intent: 'show my last order',
        summary: 'The order vessel is unavailable.',
      },
      { type: 'tool.result', ok: false },
    ]);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => value.status),
    ).toEqual(['failed']);
    expect(state.reads).toEqual({ snapshot: 0, summarize: 0 });
  });

  it('answers an ignored input truthfully that nothing was done, not as a failure', async () => {
    const state = await setup();

    state.provider.call('call-1', 'um');
    await clock.tickAsync(250);
    await state.settle(ignoredRun());

    expect(state.provider.results).toEqual([
      {
        callId: ToolCallId('call-1'),
        result: { ok: true, summary: AGENT_INPUT_IGNORED_SUMMARY },
      },
    ]);
    expect(updateEvents(state.events)).toEqual([
      { type: 'tool.submitted', intent: 'um', retry: false },
      { type: 'timing', label: 'update_ui.agent_run', ms: 250 },
      {
        type: 'tool.completed',
        intent: 'um',
        summary: AGENT_INPUT_IGNORED_SUMMARY,
      },
      { type: 'tool.result', ok: true },
    ]);
  });

  it('answers a failed run as a failure carrying its error text', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle(failedRun('The order service is unavailable.'));

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

  it.each(['ui_apply_unknown', 'ui_ack_timeout'])(
    'retains uncertainty for the active UI-only run and cancellation for queued work after %s',
    async (code) => {
      const state = await setup();
      state.provider.call('active', 'place the order');
      state.provider.call('queued', 'show the receipt');
      await clock.tickAsync(0);
      const metrics = {
        turns: 0,
        toolCalls: { requested: 0, admitted: 0 },
        elapsedMs: 10,
        inputTokens: 0,
        outputTokens: 0,
      };
      const failure = {
        ...BASE,
        ...ACCEPTED,
        disposition: 'ui_only',
        status: 'failed',
        reply: '',
        error: { code, message: 'The previous UI change was not confirmed.' },
      } as const;
      await state.settle({ ...failure, outcome: { reason: 'error', metrics } });
      await state.settle(
        {
          ...failure,
          inputId: MessageId('input-2'),
          runId: RunId('run-2'),
          outcome: { reason: 'cancelled', metrics },
        },
        1,
      );
      await clock.tickAsync(60_000);
      expect(state.session.memory.getSnapshot().outcomes).toMatchObject([
        {
          intent: 'place the order',
          status: 'unknown',
          summary: UNCONFIRMED_SUMMARY,
        },
        {
          intent: 'show the receipt',
          status: 'failed',
          summary: expect.stringContaining('cancelled before execution'),
        },
      ]);
      expect(state.provider.results).toMatchObject([
        {
          callId: 'active',
          result: { ok: false, summary: UNCONFIRMED_SUMMARY },
        },
        {
          callId: 'queued',
          result: {
            ok: false,
            summary: expect.stringContaining('cancelled before execution'),
          },
        },
      ]);
      expect(state.reads.snapshot).toBe(0);
      expect(state.agentMessages).toEqual([
        'place the order',
        'show the receipt',
      ]);
    },
  );

  it('answers a lost run as an unconfirmed failure and never sends it again', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.settle(lostRun('disconnected'));
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
    await state.settle(notSubmittedRun('not connected'));

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

  it('answers a rejecting bridge as unconfirmed, logs the rejection and never sends the message again', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rejection = new Error('bridge broke its contract');
      const state = await setup({
        sendAgentMessage: () => Promise.reject(rejection),
      });

      state.provider.call('call-1', 'show my last order');
      await clock.tickAsync(250);
      await clock.tickAsync(60_000);
      state.provider.emit({ type: 'speech_started' });
      await clock.tickAsync(60_000);

      expect(state.agentMessages).toEqual(['show my last order']);
      expect(state.legacyCalls).toEqual({
        createIntentScope: 0,
        enqueueIntent: 0,
        submitIntent: 0,
      });
      expect(state.provider.results).toEqual([
        {
          callId: ToolCallId('call-1'),
          result: { ok: false, summary: UNCONFIRMED_SUMMARY },
        },
      ]);
      expect(updateEvents(state.events)).toEqual([
        { type: 'tool.submitted', intent: 'show my last order', retry: false },
        { type: 'timing', label: 'update_ui.error', ms: 0 },
        {
          type: 'tool.unconfirmed',
          intent: 'show my last order',
          summary: UNCONFIRMED_SUMMARY,
        },
        { type: 'tool.result', ok: false },
      ]);
      expect(
        state.session.memory
          .getSnapshot()
          .outcomes.map((value) => value.status),
      ).toEqual(['unknown']);
      expect(
        warn.mock.calls.some(
          (args) =>
            args.includes('submit_intent: sendAgentMessage rejected') &&
            args.includes(rejection),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('records an outcome that settles after disconnect without delivering it or sending the message again', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.session.disconnect();
    await state.settle(finishedRun('Here it is.'));
    await clock.tickAsync(60_000);

    expect(state.agentMessages).toEqual(['show my last order']);
    expect(state.provider.results).toHaveLength(0);
    expect(state.session.memory.getSnapshot().outcomes).toMatchObject([
      {
        intent: 'show my last order',
        status: 'unknown',
        summary: 'Here it is.',
      },
    ]);
  });

  it('keeps an outcome from the previous connection away from the reconnected adapter and never replays it', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.session.disconnect();
    await state.session.connect();
    await state.settle(lostRun('disconnected'));
    await clock.tickAsync(60_000);
    state.provider.emit({ type: 'speech_started' });
    await clock.tickAsync(60_000);

    expect(state.agentMessages).toEqual(['show my last order']);
    expect(state.provider.results).toHaveLength(0);

    state.provider.call('call-2', 'show my orders');
    await clock.tickAsync(0);
    await state.settle(finishedRun('Done.'), 1);

    expect(state.agentMessages).toEqual([
      'show my last order',
      'show my orders',
    ]);
    expect(state.provider.results).toEqual([
      {
        callId: ToolCallId('call-2'),
        result: { ok: true, userMessage: 'Done.' },
      },
    ]);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => ({
        intent: value.intent,
        status: value.status,
      })),
    ).toEqual([
      { intent: 'show my last order', status: 'unknown' },
      { intent: 'show my orders', status: 'unknown' },
    ]);
  });

  it('records an outcome that settles after dispose in memory without delivering it or sending the message again', async () => {
    const state = await setup();

    state.provider.call('call-1', 'show my last order');
    await clock.tickAsync(250);
    await state.session.dispose();
    await state.settle(failedRun('The order service is unavailable.'));
    await clock.tickAsync(60_000);

    expect(state.agentMessages).toEqual(['show my last order']);
    expect(state.provider.results).toHaveLength(0);
    expect(state.session.memory.getSnapshot().outcomes).toMatchObject([
      {
        intent: 'show my last order',
        status: 'failed',
        summary: 'The order service is unavailable.',
      },
    ]);
  });
});

const BASE = {
  inputId: MessageId('input-1'),
  placeholder: null,
  turnId: null,
  changes: [],
  changeErrors: [],
} as const;

const ACCEPTED = { runId: RunId('run-1'), ack: 'On it' } as const;

const NOT_ACCEPTED = { runId: null, disposition: null, ack: null } as const;

function finishedRun(
  reply: string,
  disposition: Exclude<AgentDisposition, 'noise'> = 'agent',
): SettledAgentRun {
  return {
    ...BASE,
    ...ACCEPTED,
    disposition,
    status: 'finished',
    reply,
    outcome: {
      reason: 'completed',
      metrics: {
        turns: 1,
        toolCalls: { requested: 0, admitted: 0 },
        elapsedMs: 5,
        inputTokens: 1,
        outputTokens: 1,
      },
    },
  };
}

function ignoredRun(): SettledAgentRun {
  return {
    ...BASE,
    status: 'ignored',
    reply: '',
    runId: null,
    disposition: 'noise',
    ack: '',
  };
}

function failedRun(message: string): SettledAgentRun {
  return {
    ...BASE,
    ...ACCEPTED,
    disposition: 'agent',
    status: 'failed',
    reply: '',
    error: { message },
    outcome: null,
  };
}

function lostRun(lostReason: AgentRunLostReason): SettledAgentRun {
  return { ...BASE, ...NOT_ACCEPTED, status: 'lost', reply: '', lostReason };
}

function notSubmittedRun(message: string): SettledAgentRun {
  return {
    ...BASE,
    ...NOT_ACCEPTED,
    status: 'not_submitted',
    reply: '',
    error: { message },
  };
}

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
          name: 'submit_intent',
          argumentsJson: JSON.stringify({ intent }),
        });
    },
  };
}
