import { describe, expect, it } from 'bun:test';

import type {
  ConversationLostEvent,
  ConversationLostReason,
  InputAcceptedEvent,
  UiChangeAppliedEvent,
} from '@maelstrom-co/client';
import {
  agentErrorEvent,
  agentFinishedEvent,
  agentMessageEvent,
  agentPlaceholderEvent,
} from '@maelstrom-co/client/_testing';
import { ChangeId, MessageId, RunId } from '@maelstrom-co/protocol';

import { assertDefined } from './__tests__/assert-defined.js';
import {
  AGENT_RUNS_CAP,
  type AgentRunEvent,
  type AgentRunsSnapshot,
  EMPTY_AGENT_RUNS,
  reduceAgentRuns,
} from './agent-run-state.js';

const INPUT = MessageId('input-1');
const RUN = RunId('run-1');

describe('reduceAgentRuns', () => {
  it('creates a pending run when sendMessage registers an input', () => {
    const snapshot = reduce(sent(INPUT));

    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.run).toEqual({
      inputId: INPUT,
      runId: null,
      status: 'pending',
      placeholder: null,
      reply: '',
      turnId: null,
      changes: [],
      changeErrors: [],
      error: null,
      lostReason: null,
      finished: null,
    });
  });

  it('registers an input already lost when its send resolved after a loss', () => {
    const permanent = reduce(sent(INPUT, 'disconnected'));
    const stale = reduce(sent(INPUT, 'stale_run'));

    expect(permanent.run?.status).toBe('lost');
    expect(permanent.run?.lostReason).toBe('disconnected');
    expect(stale.run?.status).toBe('lost');
    expect(stale.run?.lostReason).toBe('stale_run');
    expect(
      reduceAgentRuns(stale, agentPlaceholderEvent(INPUT, 'Back')).run?.status,
    ).toBe('working');
  });

  it('ignores the loss of a resolved send when the input is already known', () => {
    const before = reduce(
      agentErrorEvent({ error: 'Session error' }),
      agentPlaceholderEvent(INPUT, 'Looking'),
    );
    const snapshot = reduceAgentRuns(before, sent(INPUT, 'disconnected'));

    expect(snapshot.runs).toBe(before.runs);
    expect(snapshot.run?.status).toBe('working');
    expect(snapshot.error).toBeNull();
  });

  it('keeps one run whether the placeholder arrives before or after registration', () => {
    const placeholderFirst = reduce(
      agentPlaceholderEvent(INPUT, 'Looking'),
      sent(INPUT),
    );
    const sentFirst = reduce(
      sent(INPUT),
      agentPlaceholderEvent(INPUT, 'Looking'),
    );

    expect(placeholderFirst.runs).toHaveLength(1);
    expect(placeholderFirst.run).toEqual(sentFirst.run);
    expect(placeholderFirst.run?.status).toBe('working');
    expect(placeholderFirst.run?.placeholder).toBe('Looking');
  });

  it('keeps one run whether accepted arrives before or after registration', () => {
    const acceptedFirst = reduce(accepted(INPUT, RUN), sent(INPUT));
    const sentFirst = reduce(sent(INPUT), accepted(INPUT, RUN));

    expect(acceptedFirst.runs).toHaveLength(1);
    expect(acceptedFirst.run).toEqual(sentFirst.run);
    expect(acceptedFirst.run?.runId).toBe(RUN);
    expect(acceptedFirst.run?.status).toBe('working');
  });

  it('keeps one failed run whether an input error arrives before or after registration', () => {
    const error = agentErrorEvent({
      inputId: INPUT,
      error: 'Rejected',
      code: 'busy',
    });
    const errorFirst = reduce(error, sent(INPUT));
    const sentFirst = reduce(sent(INPUT), error);

    expect(errorFirst.runs).toHaveLength(1);
    expect(errorFirst.run).toEqual(sentFirst.run);
    expect(errorFirst.run?.status).toBe('failed');
    expect(errorFirst.run?.error).toEqual({
      message: 'Rejected',
      code: 'busy',
    });
  });

  it('updates the placeholder text without leaving working', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentPlaceholderEvent(INPUT, 'Still looking'),
    );

    expect(snapshot.run?.status).toBe('working');
    expect(snapshot.run?.placeholder).toBe('Still looking');
  });

  it('finishes an accepted noise input with an empty reply', () => {
    const snapshot = reduce(sent(INPUT), accepted(INPUT, null));

    expect(snapshot.run?.status).toBe('finished');
    expect(snapshot.run?.runId).toBeNull();
    expect(snapshot.run?.reply).toBe('');
  });

  it('appends message deltas and moves the run to streaming', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentMessageEvent(RUN, 'Hello'),
      agentMessageEvent(RUN, ' there'),
    );

    expect(snapshot.run?.status).toBe('streaming');
    expect(snapshot.run?.reply).toBe('Hello there');
  });

  it('starts the reply over when a new turn begins', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentMessageEvent(RUN, 'Let me check', 'turn-1'),
      agentMessageEvent(RUN, 'Your order', 'turn-2'),
      agentMessageEvent(RUN, ' shipped', 'turn-2'),
    );

    expect(snapshot.run?.reply).toBe('Your order shipped');
    expect(snapshot.run?.turnId).toBe('turn-2');
  });

  it('appends applied UI changes in arrival order', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      uiChange(RUN, 'change-1'),
      uiChange(RUN, 'change-2'),
    );

    expect(snapshot.run?.changes).toEqual([
      { changeId: ChangeId('change-1') },
      { changeId: ChangeId('change-2') },
    ]);
  });

  it('ignores a UI change outside any run', () => {
    const before = reduce(sent(INPUT), accepted(INPUT, RUN));

    expect(reduceAgentRuns(before, uiChange(null, 'change-1'))).toBe(before);
  });

  it('replaces the streamed text with the finished reply', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentMessageEvent(RUN, 'Your ord'),
      agentFinishedEvent(RUN, { reply: 'Your order shipped.' }),
    );

    expect(snapshot.run?.status).toBe('finished');
    expect(snapshot.run?.reply).toBe('Your order shipped.');
    expect(snapshot.run?.finished).toEqual({
      ok: true,
      reason: 'completed',
      metrics: {
        turns: 1,
        toolCalls: { requested: 0, admitted: 0 },
        elapsedMs: 5,
        inputTokens: 10,
        outputTokens: 4,
      },
    });
  });

  it('keeps the streamed text when the finish carries no reply', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentMessageEvent(RUN, 'Partial'),
      agentFinishedEvent(RUN, { reply: undefined }),
    );

    expect(snapshot.run?.reply).toBe('Partial');
  });

  it('copies the error and code of a failed finish', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentFinishedEvent(RUN, {
        ok: false,
        reason: 'error',
        reply: undefined,
        error: 'Model unavailable',
        code: 'model_error',
      }),
    );

    expect(snapshot.run?.status).toBe('failed');
    expect(snapshot.run?.error).toEqual({
      message: 'Model unavailable',
      code: 'model_error',
    });
    expect(snapshot.run?.finished?.ok).toBe(false);
  });

  it('records an error naming a runId as a failed UI change without failing the run', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentErrorEvent({
        runId: RUN,
        changeId: ChangeId('change-1'),
        error: 'UI change failed',
        code: 'plan_failed',
      }),
      agentErrorEvent({ runId: RUN, error: 'Ack timed out' }),
    );

    expect(snapshot.run?.status).toBe('working');
    expect(snapshot.run?.error).toBeNull();
    expect(snapshot.run?.changeErrors).toEqual([
      {
        changeId: ChangeId('change-1'),
        message: 'UI change failed',
        code: 'plan_failed',
      },
      { changeId: null, message: 'Ack timed out' },
    ]);
    expect(snapshot.error).toBeNull();
  });

  it('keeps a run finished when a failed UI change arrives after its finish', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentMessageEvent(RUN, 'Done'),
      agentFinishedEvent(RUN, { reply: 'Done.' }),
      agentErrorEvent({ runId: RUN, error: 'UI change failed' }),
    );

    expect(snapshot.run?.status).toBe('finished');
    expect(snapshot.run?.error).toBeNull();
    expect(snapshot.run?.reply).toBe('Done.');
    expect(snapshot.run?.finished?.ok).toBe(true);
    expect(snapshot.run?.changeErrors).toEqual([
      { changeId: null, message: 'UI change failed' },
    ]);
  });

  it('keeps streaming after a failed UI change and finishes with the full reply', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentMessageEvent(RUN, 'Half'),
      agentErrorEvent({ runId: RUN, error: 'UI change failed' }),
      agentMessageEvent(RUN, ' more'),
      agentFinishedEvent(RUN, { reply: undefined }),
    );

    expect(snapshot.run?.status).toBe('finished');
    expect(snapshot.run?.reply).toBe('Half more');
    expect(snapshot.run?.error).toBeNull();
    expect(snapshot.run?.changeErrors).toHaveLength(1);
  });

  it('ignores an error naming an unknown runId even when its inputId is known', () => {
    const before = reduce(sent(INPUT), accepted(INPUT, RUN));

    const after = reduceAgentRuns(
      before,
      agentErrorEvent({
        runId: RunId('run-unknown'),
        inputId: INPUT,
        error: 'nope',
      }),
    );

    expect(after).toBe(before);
  });

  it('clears the error of an input failure when the run later finishes ok', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentErrorEvent({ inputId: INPUT, error: 'Rejected' }),
      agentFinishedEvent(RUN),
    );

    expect(snapshot.run?.status).toBe('finished');
    expect(snapshot.run?.error).toBeNull();
  });

  it('sets the snapshot error for an error naming neither input nor run', () => {
    const before = reduce(sent(INPUT), accepted(INPUT, RUN));
    const snapshot = reduceAgentRuns(
      before,
      agentErrorEvent({
        changeId: ChangeId('change-9'),
        error: 'Unknown change',
        code: 'unknown_change',
      }),
    );

    expect(snapshot.error).toEqual({
      message: 'Unknown change',
      code: 'unknown_change',
    });
    expect(snapshot.runs).toBe(before.runs);
  });

  it('clears the snapshot error when sendMessage registers a new input', () => {
    const snapshot = reduce(
      agentErrorEvent({ error: 'Session error' }),
      sent(INPUT),
    );

    expect(snapshot.error).toBeNull();
  });

  it.each([
    ['placeholder', agentPlaceholderEvent(INPUT, 'Looking up your orders')],
    ['accepted', accepted(INPUT, RUN)],
  ] as const)(
    'clears the snapshot error when %s registers an input that was never sent through the store',
    (_label, event) => {
      const snapshot = reduce(
        agentErrorEvent({ error: 'Session error' }),
        event,
      );

      expect(snapshot.error).toBeNull();
      expect(snapshot.run?.inputId).toBe(INPUT);
      expect(snapshot.run?.status).toBe('working');
    },
  );

  it('keeps the snapshot error when an event targets an input already registered', () => {
    const before = reduce(
      agentPlaceholderEvent(INPUT, 'Working'),
      agentErrorEvent({ error: 'Session error' }),
    );

    const snapshot = reduceAgentRuns(before, accepted(INPUT, RUN));

    expect(snapshot.error).toEqual({ message: 'Session error' });
  });

  it('marks every open run stale-lost on any stale loss and lets a late finish win per run', () => {
    const done = MessageId('input-done');
    const doneRun = RunId('run-done');
    const other = MessageId('input-2');
    const otherRun = RunId('run-2');
    const lost = reduce(
      sent(done),
      accepted(done, doneRun),
      agentFinishedEvent(doneRun),
      sent(INPUT),
      accepted(INPUT, RUN),
      sent(other),
      accepted(other, otherRun),
      agentMessageEvent(otherRun, 'Half'),
      staleRun(RUN),
    );

    expect(lost.runs.map((run) => run.status)).toEqual([
      'finished',
      'lost',
      'lost',
    ]);
    expect(lost.runs[1]?.lostReason).toBe('stale_run');
    expect(lost.runs[2]?.lostReason).toBe('stale_run');

    const finished = reduceAgentRuns(
      lost,
      agentFinishedEvent(otherRun, { reply: 'Late reply' }),
    );

    expect(finished.runs[1]?.status).toBe('lost');
    expect(finished.runs[1]?.lostReason).toBe('stale_run');
    expect(finished.runs[2]?.status).toBe('finished');
    expect(finished.runs[2]?.lostReason).toBeNull();
    expect(finished.runs[2]?.reply).toBe('Late reply');
  });

  it('registers an unknown stale input as stale-lost and lets a late placeholder move it on', () => {
    const lost = reduce(staleInput(INPUT));

    expect(lost.runs).toHaveLength(1);
    expect(lost.run?.inputId).toBe(INPUT);
    expect(lost.run?.status).toBe('lost');
    expect(lost.run?.lostReason).toBe('stale_run');
    expect(reduceAgentRuns(lost, sent(INPUT)).runs).toBe(lost.runs);

    const resumed = reduceAgentRuns(lost, agentPlaceholderEvent(INPUT, 'Back'));

    expect(resumed.run?.status).toBe('working');
    expect(resumed.run?.lostReason).toBeNull();
  });

  it('marks a stale input lost and lets a late placeholder move it on', () => {
    const lost = reduce(sent(INPUT), staleInput(INPUT));

    expect(lost.run?.status).toBe('lost');

    const resumed = reduceAgentRuns(lost, agentPlaceholderEvent(INPUT, 'Back'));

    expect(resumed.run?.status).toBe('working');
    expect(resumed.run?.lostReason).toBeNull();
  });

  it.each(['disconnected', 'connector_replaced'] as const)(
    'marks every unfinished run lost for good on %s',
    (reason) => {
      const done = MessageId('input-done');
      const doneRun = RunId('run-done');
      const pending = MessageId('input-pending');
      const lost = reduce(
        sent(done),
        accepted(done, doneRun),
        agentFinishedEvent(doneRun),
        sent(INPUT),
        accepted(INPUT, RUN),
        agentMessageEvent(RUN, 'Half'),
        sent(pending),
        ended(reason),
      );

      expect(lost.runs.map((run) => run.status)).toEqual([
        'finished',
        'lost',
        'lost',
      ]);
      expect(lost.runs[1]?.lostReason).toBe(reason);
      expect(lost.runs[2]?.lostReason).toBe(reason);

      const after = reduce(
        lost,
        agentMessageEvent(RUN, ' more'),
        uiChange(RUN, 'change-1'),
        agentFinishedEvent(RUN),
        agentErrorEvent({ runId: RUN, error: 'late' }),
        agentPlaceholderEvent(pending, 'late'),
        accepted(pending, RunId('run-late')),
        staleRun(RUN),
      );

      expect(after).toBe(lost);
    },
  );

  it('upgrades a stale loss to a permanent loss on disconnect', () => {
    const snapshot = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      staleRun(RUN),
      ended('disconnected'),
      agentFinishedEvent(RUN),
    );

    expect(snapshot.run?.status).toBe('lost');
    expect(snapshot.run?.lostReason).toBe('disconnected');
  });

  it('ignores events for an unknown runId', () => {
    const before = reduce(sent(INPUT), accepted(INPUT, RUN));
    const stranger = RunId('run-unknown');

    const after = reduce(
      before,
      agentMessageEvent(stranger, 'hi'),
      uiChange(stranger, 'change-1'),
      agentFinishedEvent(stranger),
      agentErrorEvent({ runId: stranger, error: 'nope' }),
    );

    expect(after).toBe(before);
  });

  it('creates no run for a stale loss naming an unknown runId but still marks open runs lost', () => {
    const before = reduce(sent(INPUT), accepted(INPUT, RUN));

    const after = reduceAgentRuns(before, staleRun(RunId('run-unknown')));

    expect(after.runs).toHaveLength(1);
    expect(after.run?.status).toBe('lost');
    expect(after.run?.lostReason).toBe('stale_run');
  });

  it('keeps at most the cap of runs and evicts the oldest', () => {
    const events: AgentRunEvent[] = [];
    for (let index = 0; index <= AGENT_RUNS_CAP; index += 1) {
      const inputId = MessageId(`input-${index}`);
      events.push(sent(inputId), accepted(inputId, RunId(`run-${index}`)));
    }
    const snapshot = events.reduce(reduceAgentRuns, EMPTY_AGENT_RUNS);

    expect(AGENT_RUNS_CAP).toBe(20);
    expect(snapshot.runs).toHaveLength(AGENT_RUNS_CAP);
    expect(snapshot.runs[0]?.inputId).toBe(MessageId('input-1'));
    expect(snapshot.run?.inputId).toBe(MessageId(`input-${AGENT_RUNS_CAP}`));

    const evictedRunEvent = reduceAgentRuns(
      snapshot,
      agentMessageEvent(RunId('run-0'), 'late'),
    );
    expect(evictedRunEvent).toBe(snapshot);
  });

  it('points run at the most recently registered input', () => {
    const second = MessageId('input-2');
    const snapshot = reduce(sent(INPUT), sent(second));

    assertDefined(snapshot.run);
    expect(snapshot.run.inputId).toBe(second);
    expect(snapshot.runs.map((run) => run.inputId)).toEqual([INPUT, second]);
  });

  it('keeps snapshot identity when an event changes nothing', () => {
    const base = reduce(
      sent(INPUT),
      accepted(INPUT, RUN),
      agentPlaceholderEvent(INPUT, 'Looking'),
      agentFinishedEvent(RUN),
    );

    expect(reduceAgentRuns(base, sent(INPUT))).toBe(base);
    expect(reduceAgentRuns(base, agentPlaceholderEvent(INPUT, 'Looking'))).toBe(
      base,
    );
    expect(reduceAgentRuns(base, accepted(INPUT, RUN))).toBe(base);
    expect(reduceAgentRuns(base, agentFinishedEvent(RUN))).toBe(base);
    expect(reduceAgentRuns(base, staleRun(RUN))).toBe(base);
    expect(reduceAgentRuns(EMPTY_AGENT_RUNS, ended('disconnected'))).toBe(
      EMPTY_AGENT_RUNS,
    );
  });

  it('never mutates the previous snapshot', () => {
    const before = reduce(sent(INPUT), accepted(INPUT, RUN));
    const frozen = structuredClone(before);

    reduce(
      before,
      agentMessageEvent(RUN, 'Hi'),
      uiChange(RUN, 'change-1'),
      agentFinishedEvent(RUN),
    );

    expect(before).toEqual(frozen);
  });
});

function reduce(
  ...items: [AgentRunsSnapshot | AgentRunEvent, ...AgentRunEvent[]]
): AgentRunsSnapshot {
  const [first, ...rest] = items;
  const start =
    'runs' in first ? first : reduceAgentRuns(EMPTY_AGENT_RUNS, first);
  return rest.reduce(reduceAgentRuns, start);
}

function sent(
  inputId: MessageId,
  lostReason?: ConversationLostReason,
): AgentRunEvent {
  return lostReason === undefined
    ? { type: 'input_sent', inputId }
    : { type: 'input_sent', inputId, lostReason };
}

function accepted(inputId: MessageId, runId: RunId | null): InputAcceptedEvent {
  return {
    type: 'accepted',
    inputId,
    runId,
    disposition: runId === null ? 'noise' : 'agent',
  };
}

function uiChange(runId: RunId | null, changeId: string): UiChangeAppliedEvent {
  return {
    type: 'ui_change',
    runId,
    changeId: ChangeId(changeId),
    actionOutcomes: [],
  };
}

function staleRun(runId: RunId): ConversationLostEvent {
  return { type: 'conversation_lost', reason: 'stale_run', runId };
}

function staleInput(inputId: MessageId): ConversationLostEvent {
  return { type: 'conversation_lost', reason: 'stale_run', inputId };
}

function ended(
  reason: 'disconnected' | 'connector_replaced',
): ConversationLostEvent {
  return { type: 'conversation_lost', reason };
}
