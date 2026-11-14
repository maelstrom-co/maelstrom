import { expect, test } from 'bun:test';

import type { DiagnosticEvent } from '@maelstrom-co/protocol';

import { retainAgentEvents } from './agent-run-history.js';
import { groupAgentRuns, panelEvents } from './panel-model.js';

interface Owner {
  clientId?: string;
  runId?: string;
  requestId?: string;
}

let sequence = 0;
function observation(
  kind: string,
  owner: Owner,
  metadata: Record<string, string | number> = {},
): DiagnosticEvent {
  sequence++;
  return {
    id: `event-${sequence}`,
    kind,
    at: sequence,
    sessionId: 'session',
    ...(owner.runId === undefined ? {} : { runId: owner.runId }),
    ...(owner.requestId === undefined ? {} : { requestId: owner.requestId }),
    metadata: { clientId: owner.clientId ?? 'app', ...metadata },
  };
}

function runOwned(runId: string, inputId: string, clientId = 'app') {
  return (kind: string, metadata: Record<string, string | number> = {}) =>
    observation(kind, { clientId, runId }, { inputId, ...metadata });
}

function session(kind: string, metadata: Record<string, string | number> = {}) {
  return observation(kind, {}, metadata);
}

function retainAll(events: readonly DiagnosticEvent[], limit: number) {
  let retained: readonly DiagnosticEvent[] = [];
  let dropped = 0;
  for (const event of events) {
    const next = retainAgentEvents(retained, event, limit);
    retained = next.events;
    dropped += next.dropped;
  }
  return { events: retained, dropped };
}

test('run-owned and session-level agent events are retained while request and unrelated events are not', () => {
  const run = runOwned('run-1', 'input-1');
  const accepted = run('engine.agent.input.accepted', { disposition: 'agent' });
  const ignored = session('engine.agent.input.ignored', {
    inputId: 'input-0',
    reason: 'duplicate_input',
  });
  const planner = run('engine.planner.completed', { turnId: 'run-1:t1' });
  const previous = retainAll([accepted, ignored, planner], 10).events;
  expect(previous).toEqual([accepted, ignored, planner]);

  for (const event of [
    observation('client.request.started', { requestId: 'request-1' }),
    observation('engine.planner.completed', { requestId: 'request-1' }),
    observation('engine.agent.input.accepted', {
      runId: 'run-2',
      requestId: 'request-2',
    }),
    observation('engine.agent.input.rejected', { requestId: 'request-3' }),
    observation('engine.agent.input.accepted', { requestId: '[REDACTED]' }),
    session('voice.session'),
    session('engine.connection.opened'),
  ]) {
    const result = retainAgentEvents(previous, event, 10);
    expect(result.events).toBe(previous);
    expect(result.dropped).toBe(0);
  }
});

test('over the limit the oldest run is evicted whole together with its linked client events', () => {
  const first = runOwned('run-1', 'input-1');
  const second = runOwned('run-2', 'input-2');
  const firstEvents = [
    session('client.agent.input.sent', { inputId: 'input-1' }),
    first('engine.agent.input.accepted', { disposition: 'agent' }),
    first('engine.agent.ui_change.emitted', { changeId: 'change-1' }),
    session('client.agent.ui.applied', { changeId: 'change-1', durationMs: 3 }),
    first('engine.agent.run.finished', { reason: 'completed' }),
  ];
  const secondEvents = [
    session('client.agent.input.sent', { inputId: 'input-2' }),
    second('engine.agent.input.accepted', { disposition: 'agent' }),
    second('engine.agent.run.started', { disposition: 'agent' }),
    second('engine.agent.run.finished', { reason: 'completed' }),
  ];
  const { events, dropped } = retainAll([...firstEvents, ...secondEvents], 6);
  expect(events).toEqual(secondEvents);
  expect(dropped).toBe(firstEvents.length);
  const model = groupAgentRuns(panelEvents(events));
  expect(model.runs.map((run) => run.runId)).toEqual(['run-2']);
  expect(model.runs[0]!.missingStart).toBe(false);
  expect(model.sessionTimelines).toEqual([]);
});

test('unlinked session events are evicted oldest first alongside whole runs', () => {
  const run = runOwned('run-1', 'input-1');
  const ignored = session('engine.agent.input.ignored', {
    inputId: 'input-0',
    reason: 'duplicate_input',
  });
  const rejected = session('engine.agent.input.rejected', {
    code: 'queue_full',
  });
  const runEvents = [
    run('engine.agent.input.accepted', { disposition: 'agent' }),
    run('engine.agent.run.finished', { reason: 'completed' }),
  ];
  const noise = session('engine.agent.input.accepted', {
    inputId: 'input-9',
    disposition: 'noise',
  });
  const all = [ignored, rejected, ...runEvents, noise];
  expect(retainAll(all, 4)).toEqual({
    events: [rejected, ...runEvents, noise],
    dropped: 1,
  });
  expect(retainAll(all, 3)).toEqual({
    events: [...runEvents, noise],
    dropped: 2,
  });
  expect(retainAll(all, 2)).toEqual({ events: [noise], dropped: 4 });
});

test('a client event that arrived before its engine event is evicted with the run it links to', () => {
  const first = runOwned('run-1', 'input-1');
  const sent = session('client.agent.input.sent', { inputId: 'input-1' });
  const unrelated = session('engine.agent.input.rejected', {
    code: 'invalid_input',
  });
  const firstEvents = [
    first('engine.agent.input.accepted', { disposition: 'agent' }),
    first('engine.agent.run.finished', { reason: 'completed' }),
  ];
  const later = runOwned('run-2', 'input-2')('engine.agent.input.accepted', {
    disposition: 'agent',
  });
  const { events, dropped } = retainAll(
    [sent, unrelated, ...firstEvents, later],
    4,
  );
  expect(dropped).toBe(3);
  expect(events).toEqual([unrelated, later]);
});

test('a reused input id links the client event to the newest run for eviction', () => {
  const older = runOwned('run-1', 'input-1');
  const newer = runOwned('run-2', 'input-1');
  const olderEvents = [
    older('engine.agent.input.accepted', { disposition: 'agent' }),
    older('engine.agent.run.finished', { reason: 'completed' }),
  ];
  const newerAccepted = newer('engine.agent.input.accepted', {
    disposition: 'agent',
  });
  const sent = session('client.agent.input.sent', { inputId: 'input-1' });
  const { events } = retainAll([...olderEvents, newerAccepted, sent], 3);
  expect(events).toEqual([newerAccepted, sent]);
});

test('the same run id from two clients is retained and evicted as two runs', () => {
  const fromFirst = runOwned('run-1', 'input-1', 'first');
  const fromSecond = runOwned('run-1', 'input-1', 'second');
  const firstEvents = [
    fromFirst('engine.agent.input.accepted', { disposition: 'agent' }),
    fromFirst('engine.agent.run.finished', { reason: 'completed' }),
  ];
  const secondEvents = [
    fromSecond('engine.agent.input.accepted', { disposition: 'agent' }),
    fromSecond('engine.agent.run.finished', { reason: 'completed' }),
  ];
  expect(retainAll([...firstEvents, ...secondEvents], 3)).toEqual({
    events: secondEvents,
    dropped: 2,
  });
});

test('one run larger than the limit stays as partial evidence of its latest events', () => {
  const run = runOwned('run-1', 'input-1');
  const events = [
    run('engine.agent.input.accepted', { disposition: 'agent' }),
    run('engine.agent.run.started', { disposition: 'agent' }),
    run('engine.agent.turn.started', { turnId: 'run-1:t1', turnIndex: 1 }),
    run('engine.agent.turn.finished', { turnId: 'run-1:t1', turnIndex: 1 }),
    run('engine.agent.run.finished', { reason: 'completed' }),
  ];
  const retained = retainAll(events, 3);
  expect(retained).toEqual({ events: events.slice(-3), dropped: 2 });
  const [trace] = groupAgentRuns(panelEvents(retained.events)).runs;
  expect(trace!.missingStart).toBe(true);
  expect(trace!.status).toBe('completed');
});
