import { describe, expect, it } from 'bun:test';

import { ChangeId, MessageId, RunId } from '@maelstrom-co/protocol';

import {
  agentAcceptedEvent,
  agentErrorEvent,
  agentFinishedEvent,
  agentMessageEvent,
  agentPlaceholderEvent,
} from '../__test-helpers__/agent-connector-mock.js';
import {
  type AgentRunEntries,
  type AgentRunEvent,
  type AgentRunState,
  EMPTY_AGENT_RUN_ENTRIES,
  isSettled,
  reduceAgentRuns,
} from './agent-run-state.js';

const INPUT = MessageId('input-1');
const OTHER_INPUT = MessageId('input-2');
const RUN = RunId('run-1');
const OTHER_RUN = RunId('run-2');
const CHANGE = ChangeId('change-1');

describe('reduceAgentRuns', () => {
  it('registers a sent input as pending with no acceptance', () => {
    const entries = fold({ type: 'input_sent', inputId: INPUT });

    expect(only(entries)).toEqual({
      inputId: INPUT,
      status: 'pending',
      runId: null,
      disposition: null,
      ack: null,
      placeholder: null,
      reply: '',
      turnId: null,
      changes: [],
      changeErrors: [],
    });
  });

  it('ignores events for inputs and runs it never registered', () => {
    const entries = fold(
      agentPlaceholderEvent(INPUT),
      agentAcceptedEvent(INPUT, RUN),
      agentMessageEvent(RUN, 'hi'),
      agentFinishedEvent(RUN),
      agentErrorEvent({ inputId: INPUT, error: 'rejected' }),
      { type: 'conversation_lost', reason: 'stale_run', inputId: INPUT },
    );

    expect(entries).toBe(EMPTY_AGENT_RUN_ENTRIES);
  });

  it('keeps a placeholder on a pending input until the agent accepts it', () => {
    const entries = fold(
      { type: 'input_sent', inputId: INPUT },
      agentPlaceholderEvent(INPUT, 'Looking it up'),
    );

    expect(only(entries)).toMatchObject({
      status: 'pending',
      placeholder: 'Looking it up',
    });
  });

  it('moves an accepted input to working with its run, disposition and ack', () => {
    const entries = fold(
      { type: 'input_sent', inputId: INPUT },
      agentAcceptedEvent(INPUT, RUN, 'ui_only'),
    );

    expect(only(entries)).toMatchObject({
      status: 'working',
      runId: RUN,
      disposition: 'ui_only',
      ack: 'On it',
    });
  });

  it('marks a noise input ignored with its ack and no run', () => {
    const entries = fold(
      { type: 'input_sent', inputId: INPUT },
      { ...agentAcceptedEvent(INPUT, null), ack: 'Okay' },
    );

    expect(only(entries)).toMatchObject({
      status: 'ignored',
      runId: null,
      disposition: 'noise',
      ack: 'Okay',
    });
    expect(isSettled(only(entries))).toBe(true);
  });

  it('streams deltas and starts the reply over on a new turn', () => {
    const entries = fold(
      ...accepted(),
      agentMessageEvent(RUN, 'Hello ', 'turn-1'),
      agentMessageEvent(RUN, 'there', 'turn-1'),
      agentMessageEvent(RUN, 'Again', 'turn-2'),
    );

    expect(only(entries)).toMatchObject({
      status: 'streaming',
      reply: 'Again',
      turnId: 'turn-2',
    });
  });

  it('finishes with the final reply and the outcome, keeping the acceptance', () => {
    const finished = agentFinishedEvent(RUN, { reply: 'Here it is.' });
    const entries = fold(
      ...accepted(),
      agentMessageEvent(RUN, 'Here'),
      finished,
    );

    expect(only(entries)).toMatchObject({
      status: 'finished',
      runId: RUN,
      disposition: 'agent',
      ack: 'On it',
      reply: 'Here it is.',
      outcome: { reason: 'completed', metrics: finished.metrics },
    });
    expect(only(entries)).not.toHaveProperty('ok');
  });

  it('fails a run that finished without reaching its goal', () => {
    const entries = fold(
      ...accepted(),
      agentFinishedEvent(RUN, {
        ok: false,
        reason: 'error',
        reply: undefined,
        error: 'The model could not respond.',
        code: 'provider_error',
      }),
    );

    expect(only(entries)).toMatchObject({
      status: 'failed',
      runId: RUN,
      error: {
        message: 'The model could not respond.',
        code: 'provider_error',
      },
      outcome: { reason: 'error' },
    });
  });

  it('fails a rejected input with no outcome and no acceptance', () => {
    const entries = fold(
      { type: 'input_sent', inputId: INPUT },
      agentErrorEvent({ inputId: INPUT, error: 'busy', code: 'busy' }),
    );

    expect(only(entries)).toMatchObject({
      status: 'failed',
      runId: null,
      ack: null,
      outcome: null,
      error: { message: 'busy', code: 'busy' },
    });
  });

  it('records applied changes and failed changes without changing the status', () => {
    const entries = fold(
      ...accepted(),
      uiChange(RUN, CHANGE),
      agentErrorEvent({ runId: RUN, changeId: CHANGE, error: 'no vessel' }),
    );

    expect(only(entries)).toMatchObject({
      status: 'working',
      changes: [{ changeId: CHANGE }],
      changeErrors: [{ changeId: CHANGE, message: 'no vessel' }],
    });
  });

  it('settles every open input lost on any stale_run, even one it does not name', () => {
    const entries = fold(
      ...accepted(),
      { type: 'input_sent', inputId: OTHER_INPUT },
      { type: 'conversation_lost', reason: 'stale_run', runId: OTHER_RUN },
    );

    expect(entries.runs.map(statusAndReason)).toEqual([
      ['lost', 'stale_run'],
      ['lost', 'stale_run'],
    ]);
    expect(entries.runs[0]).toMatchObject({ runId: RUN, ack: 'On it' });
  });

  it('leaves settled runs alone on a stale_run', () => {
    const before = fold(...accepted(), agentFinishedEvent(RUN));

    expect(
      reduceAgentRuns(before, {
        type: 'conversation_lost',
        reason: 'stale_run',
        runId: RUN,
      }),
    ).toBe(before);
  });

  it('keeps applying late events after a stale_run loss', () => {
    const entries = fold(
      ...accepted(),
      { type: 'conversation_lost', reason: 'stale_run', runId: RUN },
      agentFinishedEvent(RUN, { reply: 'Late but done' }),
    );

    expect(only(entries)).toMatchObject({
      status: 'finished',
      reply: 'Late but done',
    });
  });

  it('moves a stale-lost input that was never accepted back to pending on a late placeholder', () => {
    const entries = fold(
      { type: 'input_sent', inputId: INPUT },
      { type: 'conversation_lost', reason: 'stale_run', inputId: INPUT },
      agentPlaceholderEvent(INPUT, 'Still here'),
    );

    expect(only(entries)).toMatchObject({
      status: 'pending',
      placeholder: 'Still here',
    });
  });

  it('makes a disconnect final for open and stale-lost runs', () => {
    const entries = fold(
      ...accepted(),
      { type: 'conversation_lost', reason: 'stale_run', runId: RUN },
      { type: 'input_sent', inputId: OTHER_INPUT },
      { type: 'conversation_lost', reason: 'disconnected' },
      agentFinishedEvent(RUN),
      agentAcceptedEvent(OTHER_INPUT, OTHER_RUN),
    );

    expect(entries.runs.map(statusAndReason)).toEqual([
      ['lost', 'disconnected'],
      ['lost', 'disconnected'],
    ]);
  });

  it('records a pre-send failure as not_submitted and ignores later events for it', () => {
    const entries = fold(
      { type: 'input_sent', inputId: INPUT },
      {
        type: 'input_not_submitted',
        inputId: INPUT,
        error: { message: 'Orchestrator is not connected' },
      },
      agentAcceptedEvent(INPUT, RUN),
    );

    expect(only(entries)).toMatchObject({
      status: 'not_submitted',
      runId: null,
      error: { message: 'Orchestrator is not connected' },
    });
  });

  it('records a refused send as a recoverable send_failed loss', () => {
    const entries = fold(
      { type: 'input_sent', inputId: INPUT },
      { type: 'input_send_failed', inputId: INPUT },
    );
    expect(statusAndReason(only(entries))).toEqual(['lost', 'send_failed']);

    const recovered = reduceAgentRuns(entries, agentAcceptedEvent(INPUT, RUN));
    expect(only(recovered)).toMatchObject({ status: 'working', runId: RUN });
  });

  it('clears the conversation error on the next sent input', () => {
    const entries = fold(agentErrorEvent({ error: 'conversation failure' }));
    expect(entries.error).toEqual({ message: 'conversation failure' });

    expect(
      reduceAgentRuns(entries, { type: 'input_sent', inputId: INPUT }).error,
    ).toBeNull();
  });

  it('returns the same entries when an event changes nothing', () => {
    const before = fold(
      { type: 'input_sent', inputId: INPUT },
      agentPlaceholderEvent(INPUT, 'same'),
    );

    expect(reduceAgentRuns(before, agentPlaceholderEvent(INPUT, 'same'))).toBe(
      before,
    );
    expect(reduceAgentRuns(before, agentMessageEvent(RUN, 'x'))).toBe(before);
  });
});

describe('isSettled', () => {
  it('treats pending, working and streaming as open', () => {
    const pending = only(fold({ type: 'input_sent', inputId: INPUT }));
    const working = only(fold(...accepted()));
    const streaming = only(fold(...accepted(), agentMessageEvent(RUN, 'x')));

    expect([pending, working, streaming].map(isSettled)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

function fold(...events: AgentRunEvent[]): AgentRunEntries {
  return events.reduce(reduceAgentRuns, EMPTY_AGENT_RUN_ENTRIES);
}

function accepted(): AgentRunEvent[] {
  return [
    { type: 'input_sent', inputId: INPUT },
    agentAcceptedEvent(INPUT, RUN),
  ];
}

function uiChange(runId: RunId, changeId: ChangeId): AgentRunEvent {
  return { type: 'ui_change', runId, changeId, actionOutcomes: [] };
}

function only(entries: AgentRunEntries): AgentRunState {
  expect(entries.runs).toHaveLength(1);
  const [run] = entries.runs;
  if (run === undefined) throw new Error('expected one run');
  return run;
}

function statusAndReason(run: AgentRunState): [string, string | null] {
  return [run.status, run.status === 'lost' ? run.lostReason : null];
}
