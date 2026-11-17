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

  it('keeps an input pending through a loss reported while it registers, loses the other open inputs and settles it once as not submitted', async () => {
    const { tracker, events } = setup();
    const earlier = register(tracker, MessageId('input-1'));
    const statusesDuringLoss: string[][] = [];
    tracker.store.subscribe(() => {
      if (tracker.store.state.run?.inputId !== MessageId('input-2')) return;
      if (statusesDuringLoss.length > 0) return;
      statusesDuringLoss.push([]);
      events.emit('conversation_lost', {
        type: 'conversation_lost',
        reason: 'connector_replaced',
      });
      statusesDuringLoss[0] = tracker.store.state.runs.map((run) => run.status);
    });

    const later = register(tracker, MessageId('input-2'));
    tracker.notSubmitted(MessageId('input-2'), { message: 'never sent' });

    expect(statusesDuringLoss).toEqual([['lost', 'pending']]);
    expect(await earlier).toMatchObject({
      status: 'lost',
      lostReason: 'connector_replaced',
    });
    expect(await later).toMatchObject({
      status: 'not_submitted',
      error: { message: 'never sent' },
    });
    expect(tracker.store.state.runs.map((run) => run.status)).toEqual([
      'lost',
      'not_submitted',
    ]);
  });

  it('applies and settles every change, reporting the error, when a store subscriber throws', async () => {
    const reported: unknown[] = [];
    const { tracker } = setup((_message, error) => reported.push(error));
    const failure = new Error('subscriber failed');
    tracker.store.subscribe(() => {
      throw failure;
    });

    const first = tracker.track(MessageId('input-1'));
    tracker.sending(MessageId('input-1'));
    const pendingStatus = tracker.store.state.run?.status;
    tracker.sendFailed(MessageId('input-1'));
    const second = tracker.track(MessageId('input-2'));
    tracker.notSubmitted(MessageId('input-2'), { message: 'never sent' });

    expect(pendingStatus).toBe('pending');
    expect(await first).toMatchObject({
      status: 'lost',
      lostReason: 'send_failed',
    });
    expect(await second).toMatchObject({ status: 'not_submitted' });
    expect(reported).toEqual([failure, failure, failure]);
  });

  it('loses an input to a loss reported after it registered', async () => {
    const { tracker, events } = setup();
    const result = register(tracker, MessageId('input-1'));

    events.emit('conversation_lost', {
      type: 'conversation_lost',
      reason: 'connector_replaced',
    });
    tracker.notSubmitted(MessageId('input-1'), { message: 'too late' });

    expect(await result).toMatchObject({
      status: 'lost',
      lostReason: 'connector_replaced',
    });
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

function setup(
  reportError: (message: string, error: unknown) => void = () => {},
) {
  const events = new TypedEmitter<AgentConversationEvents>();
  const tracker = new AgentRunTracker(events, { error: reportError });
  return { events, tracker };
}

function toAccepted(
  inputId: MessageId,
  runId: RunId,
): AgentConversationEvents['accepted'] {
  const { type, disposition, ack } = agentAcceptedEvent(inputId, runId);
  return { type, inputId, runId, disposition, ack };
}
