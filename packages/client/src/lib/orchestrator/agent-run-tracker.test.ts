import { describe, expect, it } from 'bun:test';

import { MessageId, RunId } from '@maelstrom-co/protocol';

import {
  agentAcceptedEvent,
  agentFinishedEvent,
  agentPlaceholderEvent,
} from '../__test-helpers__/agent-connector-mock.js';
import { TypedEmitter } from '../utils/typed-emitter.js';
import {
  AGENT_RUNS_CAP,
  EMPTY_AGENT_RUNS,
  type SettledAgentRun,
} from './agent-run-state.js';
import { AgentRunTracker } from './agent-run-tracker.js';
import type { AgentConversationEvents } from './conversation-event.types.js';

describe('AgentRunTracker', () => {
  it('starts from the empty snapshot', () => {
    const { tracker } = setup();

    expect(tracker.store.state).toBe(EMPTY_AGENT_RUNS);
  });

  it('publishes a registered input and the events that follow it', () => {
    const { tracker, events } = setup();
    const input = MessageId('input-1');
    const run = RunId('run-1');
    let notifications = 0;
    tracker.store.subscribe(() => {
      notifications++;
    });

    void register(tracker, input);
    events.emit('accepted', toAccepted(input, run));

    expect(notifications).toBe(2);
    expect(tracker.store.state.run).toMatchObject({
      inputId: input,
      status: 'working',
      runId: run,
    });
  });

  it('settles the result once with the state at settle time and keeps applying late events to the store', async () => {
    const { tracker, events } = setup();
    const input = MessageId('input-1');
    const run = RunId('run-1');

    const result = register(tracker, input);
    events.emit('accepted', toAccepted(input, run));
    events.emit('conversation_lost', {
      type: 'conversation_lost',
      reason: 'stale_run',
      runId: run,
    });
    events.emit('finished', agentFinishedEvent(run, { reply: 'Late' }));

    expect(await result).toMatchObject({
      status: 'lost',
      lostReason: 'stale_run',
    });
    expect(tracker.store.state.run).toMatchObject({
      status: 'finished',
      reply: 'Late',
    });
  });

  it('settles not_submitted and send_failed inputs', async () => {
    const { tracker } = setup();
    const notSent = MessageId('input-1');
    const refused = MessageId('input-2');

    const notSentResult = register(tracker, notSent);
    tracker.notSubmitted(notSent, { message: 'Orchestrator is disposed' });
    const refusedResult = register(tracker, refused);
    tracker.sendFailed(refused);

    expect(await notSentResult).toMatchObject({
      status: 'not_submitted',
      error: { message: 'Orchestrator is disposed' },
    });
    expect(await refusedResult).toMatchObject({
      status: 'lost',
      lostReason: 'send_failed',
    });
  });

  it('caps the store but still settles the result of an evicted input', async () => {
    const { tracker, events } = setup();
    const first = MessageId('input-0');
    const run = RunId('run-0');
    const firstResult = register(tracker, first);
    events.emit('accepted', toAccepted(first, run));
    for (let index = 1; index <= AGENT_RUNS_CAP; index++)
      void register(tracker, MessageId(`input-${index}`));

    expect(tracker.store.state.runs).toHaveLength(AGENT_RUNS_CAP);
    expect(
      tracker.store.state.runs.some((known) => known.inputId === first),
    ).toBe(false);

    const before = tracker.store.state;
    events.emit('finished', agentFinishedEvent(run, { reply: 'Done' }));

    const settled: SettledAgentRun = await firstResult;
    expect(settled).toMatchObject({ status: 'finished', reply: 'Done' });
    expect(tracker.store.state).toBe(before);
  });

  it('ignores events for inputs it never registered', () => {
    const { tracker, events } = setup();

    events.emit('placeholder', agentPlaceholderEvent(MessageId('voice-1')));

    expect(tracker.store.state).toBe(EMPTY_AGENT_RUNS);
  });

  it('settles every pending result lost on a disconnect', async () => {
    const { tracker, events } = setup();
    const results = [
      register(tracker, MessageId('input-1')),
      register(tracker, MessageId('input-2')),
    ];

    events.emit('conversation_lost', {
      type: 'conversation_lost',
      reason: 'disconnected',
    });

    expect((await Promise.all(results)).map((run) => run.status)).toEqual([
      'lost',
      'lost',
    ]);
  });
});

function register(
  tracker: AgentRunTracker,
  inputId: MessageId,
): Promise<SettledAgentRun> {
  const result = tracker.track(inputId);
  tracker.sending(inputId);
  return result;
}

function setup() {
  const events = new TypedEmitter<AgentConversationEvents>();
  const tracker = new AgentRunTracker(events);
  return { events, tracker };
}

function toAccepted(
  inputId: MessageId,
  runId: RunId,
): AgentConversationEvents['accepted'] {
  const { type, disposition, ack } = agentAcceptedEvent(inputId, runId);
  return { type, inputId, runId, disposition, ack };
}
