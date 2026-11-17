import { afterEach, describe, expect, it } from 'bun:test';

import {
  type AgentConversationEvents,
  type EngineConnector,
  Orchestrator,
  TypedEmitter,
} from '@maelstrom-co/client';
import {
  agentAcceptedEvent,
  agentFinishedEvent,
  agentMessageEvent,
  agentPlaceholderEvent,
  agentUiChangeEvent,
  type MockAgentConnector,
} from '@maelstrom-co/client/_testing';
import {
  ChangeId,
  type MaelstromResponse,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';

import { assertDefined } from './__tests__/assert-defined.js';
import { createMockAgentEngineConnector } from './__tests__/mock-connector.js';
import { AGENT_RUNS_CAP, EMPTY_AGENT_RUNS } from './agent-run-state.js';
import { type AgentRunStore, createAgentRunStore } from './agent-run-store.js';

const RUN = RunId('run-1');
const CHANGE = ChangeId('change-1');
const INPUT = MessageId('input-1');

let cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

describe('createAgentRunStore', () => {
  it('starts from the empty snapshot', async () => {
    const { store } = await setup();

    expect(store.getSnapshot()).toBe(EMPTY_AGENT_RUNS);
  });

  it('folds a full Agent Run from the Orchestrator into the snapshot and notifies subscribers', async () => {
    const { agent, store } = await setup();
    let notifications = 0;
    store.subscribe(() => {
      notifications++;
    });

    const inputId = await store.sendMessage('show my last order');
    agent.emit(agentPlaceholderEvent(inputId, 'Looking it up'));
    agent.emit(agentAcceptedEvent(inputId, RUN));
    agent.emit(agentMessageEvent(RUN, 'Here is '));
    agent.emit(agentMessageEvent(RUN, 'your order'));
    const applied = agent.nextInput('ui_applied');
    agent.emit(agentUiChangeEvent(RUN, CHANGE, emptyResponse()));
    await applied;
    await drainMicrotasks();
    agent.emit(agentFinishedEvent(RUN, { reply: 'Here is your order.' }));

    const snapshot = store.getSnapshot();
    expect(notifications).toBe(7);
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.run).toEqual({
      inputId,
      runId: RUN,
      status: 'finished',
      placeholder: 'Looking it up',
      reply: 'Here is your order.',
      turnId: 'turn-1',
      changes: [{ changeId: CHANGE }],
      changeErrors: [],
      error: null,
      lostReason: null,
      finished: {
        ok: true,
        reason: 'completed',
        metrics: agentFinishedEvent(RUN).metrics,
      },
    });
  });

  it('shows the streamed reply while the run is still open', async () => {
    const { agent, store } = await setup();

    const inputId = await store.sendMessage('hello');
    agent.emit(agentAcceptedEvent(inputId, RUN));
    agent.emit(agentMessageEvent(RUN, 'Hi'));
    agent.emit(agentMessageEvent(RUN, ' there'));

    const run = store.getSnapshot().run;
    assertDefined(run);
    expect(run.status).toBe('streaming');
    expect(run.reply).toBe('Hi there');
  });

  it('resolves sendMessage to the input id the agent saw and registers a pending run', async () => {
    const { agent, store } = await setup();

    const inputId = await store.sendMessage('show the board', {
      source: 'voice',
    });

    const utterance = agent.inputs.find((input) => input.type === 'utterance');
    expect(utterance?.inputId).toBe(inputId);
    expect(utterance?.source).toBe('voice');
    const run = store.getSnapshot().run;
    assertDefined(run);
    expect(run.inputId).toBe(inputId);
    expect(run.status).toBe('pending');
  });

  it('propagates a sendMessage rejection and leaves no run', async () => {
    const { store } = await setup({ connect: false });
    let notifications = 0;
    store.subscribe(() => {
      notifications++;
    });

    await expect(store.sendMessage('hello')).rejects.toThrow(
      'Orchestrator is not connected',
    );

    expect(store.getSnapshot()).toBe(EMPTY_AGENT_RUNS);
    expect(notifications).toBe(0);
  });

  it('registers an input already lost when the Orchestrator disconnects while its send is in flight', async () => {
    const held = Promise.withResolvers<void>();
    const { agent, orchestrator, store } = await setup({
      sendInput: () => held.promise,
    });

    const utterance = agent.nextInput('utterance');
    const sending = store.sendMessage('hello');
    await utterance;
    await orchestrator.disconnect();
    held.resolve();
    const inputId = await sending;

    const run = store.getSnapshot().run;
    assertDefined(run);
    expect(run.inputId).toBe(inputId);
    expect(run.status).toBe('lost');
    expect(run.lostReason).toBe('disconnected');
  });

  it('registers an input already lost when the connector is replaced while its send is in flight', async () => {
    const held = Promise.withResolvers<void>();
    const { agent, orchestrator, store } = await setup({
      sendInput: () => held.promise,
    });

    const utterance = agent.nextInput('utterance');
    const sending = store.sendMessage('hello');
    await utterance;
    orchestrator.setConnector(createMockAgentEngineConnector().connector);
    held.resolve();
    const inputId = await sending;

    const run = store.getSnapshot().run;
    assertDefined(run);
    expect(run.inputId).toBe(inputId);
    expect(run.status).toBe('lost');
    expect(run.lostReason).toBe('connector_replaced');
  });

  it('registers an input stale-lost when a stale loss for another subject lands during its send, and late events move it on', async () => {
    const fake = createFakeOrchestrator();
    const store = createAgentRunStore(fake.orchestrator);
    cleanups.push(() => store.dispose());

    const sending = store.sendMessage('hello');
    fake.agent.emit('conversation_lost', {
      type: 'conversation_lost',
      reason: 'stale_run',
      runId: RunId('run-other'),
    });
    fake.resolveSend(INPUT);
    expect(await sending).toBe(INPUT);

    expect(store.getSnapshot().run?.status).toBe('lost');
    expect(store.getSnapshot().run?.lostReason).toBe('stale_run');

    fake.agent.emit('placeholder', agentPlaceholderEvent(INPUT, 'Back'));

    expect(store.getSnapshot().run?.status).toBe('working');
    expect(store.getSnapshot().run?.lostReason).toBeNull();
  });

  it('keeps a run created by an event that arrived after the loss and before the send resolved', async () => {
    const fake = createFakeOrchestrator();
    const store = createAgentRunStore(fake.orchestrator);
    cleanups.push(() => store.dispose());

    const sending = store.sendMessage('hello');
    fake.agent.emit('conversation_lost', {
      type: 'conversation_lost',
      reason: 'stale_run',
      runId: RunId('run-other'),
    });
    fake.agent.emit('placeholder', agentPlaceholderEvent(INPUT, 'Looking'));
    fake.resolveSend(INPUT);
    await sending;

    expect(store.getSnapshot().runs).toHaveLength(1);
    expect(store.getSnapshot().run?.status).toBe('working');
    expect(store.getSnapshot().run?.lostReason).toBeNull();
  });

  it('does not register an input again when its run was evicted before its send resolved', async () => {
    const held = Promise.withResolvers<void>();
    let utterances = 0;
    const { agent, store } = await setup({
      sendInput: (input) =>
        input.type === 'utterance' && utterances++ === 0
          ? held.promise
          : Promise.resolve(),
    });

    const utterance = agent.nextInput('utterance');
    const sending = store.sendMessage('a');
    const sentInput = await utterance;
    const evictedInputId = sentInput.inputId;
    agent.emit(agentAcceptedEvent(evictedInputId, RUN));
    agent.emit(agentFinishedEvent(RUN));
    const newerInputIds = Array.from({ length: AGENT_RUNS_CAP }, (_, index) =>
      MessageId(`newer-${index}`),
    );
    for (const inputId of newerInputIds) {
      agent.emit(agentPlaceholderEvent(inputId, 'working'));
    }
    const beforeResolve = store.getSnapshot();
    held.resolve();

    expect(await sending).toBe(evictedInputId);
    const snapshot = store.getSnapshot();
    expect(snapshot).toBe(beforeResolve);
    expect(snapshot.runs).toHaveLength(AGENT_RUNS_CAP);
    expect(
      snapshot.runs.some((run) => run.inputId === evictedInputId),
    ).toBeFalse();
    expect(snapshot.runs[0]?.inputId).toBe(newerInputIds[0]);
  });

  it('still registers a new input whose send resolves while another send is in flight', async () => {
    const held = Promise.withResolvers<void>();
    let utterances = 0;
    const { agent, store } = await setup({
      sendInput: (input) =>
        input.type === 'utterance' && utterances++ === 0
          ? held.promise
          : Promise.resolve(),
    });

    const firstUtterance = agent.nextInput('utterance');
    const firstSending = store.sendMessage('first');
    await firstUtterance;
    const secondInputId = await store.sendMessage('second');

    expect(store.getSnapshot().run?.inputId).toBe(secondInputId);
    expect(store.getSnapshot().run?.status).toBe('pending');

    held.resolve();
    const firstInputId = await firstSending;
    expect(store.getSnapshot().runs.map((run) => run.inputId)).toEqual([
      secondInputId,
      firstInputId,
    ]);
  });

  it('keeps snapshot identity between unchanged reads', async () => {
    const { agent, store } = await setup();

    const inputId = await store.sendMessage('hello');
    const first = store.getSnapshot();

    expect(store.getSnapshot()).toBe(first);
    agent.emit(agentMessageEvent(RunId('run-unknown'), 'ignored'));
    expect(store.getSnapshot()).toBe(first);
    agent.emit(agentPlaceholderEvent(inputId, 'working'));
    expect(store.getSnapshot()).not.toBe(first);
  });

  it('notifies listeners only when the snapshot changes', async () => {
    const { agent, store } = await setup();
    const inputId = await store.sendMessage('hello');
    let notifications = 0;
    store.subscribe(() => {
      notifications++;
    });

    agent.emit(agentPlaceholderEvent(inputId, 'working'));
    agent.emit(agentPlaceholderEvent(inputId, 'working'));
    agent.emit(agentMessageEvent(RunId('run-unknown'), 'ignored'));

    expect(notifications).toBe(1);
  });

  it('stops notifying a listener after it unsubscribes', async () => {
    const { agent, store } = await setup();
    const inputId = await store.sendMessage('hello');
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications++;
    });

    unsubscribe();
    agent.emit(agentPlaceholderEvent(inputId, 'working'));

    expect(notifications).toBe(0);
    expect(store.getSnapshot().run?.placeholder).toBe('working');
  });

  it('stops folding events and calling listeners after dispose, and dispose is idempotent', async () => {
    const { agent, store } = await setup();
    const inputId = await store.sendMessage('hello');
    let notifications = 0;
    store.subscribe(() => {
      notifications++;
    });
    const before = store.getSnapshot();

    store.dispose();
    store.dispose();
    agent.emit(agentPlaceholderEvent(inputId, 'working'));
    agent.emit(agentAcceptedEvent(inputId, RUN));

    expect(store.getSnapshot()).toBe(before);
    expect(notifications).toBe(0);
  });

  it('lets the Orchestrator dispose after the store without throwing', async () => {
    const { store, orchestrator } = await setup({ disposeOrchestrator: false });

    store.dispose();

    await orchestrator.dispose();
  });
});

async function setup(
  options: {
    connect?: boolean;
    disposeOrchestrator?: boolean;
    sendInput?: EngineConnector['sendInput'];
  } = {},
): Promise<{
  agent: MockAgentConnector;
  orchestrator: Orchestrator;
  store: AgentRunStore;
}> {
  const agent = createMockAgentEngineConnector(
    options.sendInput === undefined ? {} : { sendInput: options.sendInput },
  );
  const orchestrator = new Orchestrator(agent.connector, {
    agentRunStaleTimeoutMs: Infinity,
  });
  await orchestrator.commandProcessor.waitForIdle();
  if (options.connect !== false) await orchestrator.connect();
  if (options.disposeOrchestrator !== false) {
    cleanups.push(() => orchestrator.dispose());
  }
  const store = createAgentRunStore(orchestrator);
  cleanups.push(() => store.dispose());
  return { agent, orchestrator, store };
}

function createFakeOrchestrator(): {
  orchestrator: Pick<Orchestrator, 'agent' | 'sendMessage'>;
  agent: TypedEmitter<AgentConversationEvents>;
  resolveSend(inputId: MessageId): void;
} {
  const agent = new TypedEmitter<AgentConversationEvents>();
  const send = Promise.withResolvers<MessageId>();
  return {
    orchestrator: { agent, sendMessage: () => send.promise },
    agent,
    resolveSend: (inputId) => send.resolve(inputId),
  };
}

function emptyResponse(): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: MessageId('response-change-1'),
    userMessage: '',
    rationale: 'agent change',
    executionPlan: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  };
}

async function drainMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
