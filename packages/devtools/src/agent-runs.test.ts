import { expect, test } from 'bun:test';

import {
  type AgentRunTrace,
  groupAgentRuns,
  groupRequests,
  panelEvents,
} from './panel-model.js';

interface Owner {
  clientId?: string;
  runId?: string;
  requestId?: string;
}

let sequence = 0;
function observation(
  kind: string,
  owner: Owner,
  metadata: Record<string, unknown> = {},
) {
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
  return (kind: string, metadata: Record<string, unknown> = {}) =>
    observation(kind, { clientId, runId }, { inputId, ...metadata });
}

function session(kind: string, metadata: Record<string, unknown> = {}) {
  return observation(kind, {}, metadata);
}

function finished(
  reason: string,
  outcome: string,
  extra: Record<string, unknown> = {},
) {
  return {
    reason,
    outcome,
    turns: 1,
    toolCalls: 1,
    elapsedMs: 42,
    durationMs: 42,
    inputTokens: 10,
    outputTokens: 5,
    ...extra,
  };
}

function onlyRun(values: readonly unknown[]): AgentRunTrace {
  const { runs } = groupAgentRuns(panelEvents(values));
  expect(runs).toHaveLength(1);
  return runs[0]!;
}

test('one agent run groups by client and run id with metrics and turns from its events', () => {
  const event = runOwned('run-1', 'input-1');
  const turnId = 'run-1:t1';
  const run = onlyRun([
    event('engine.agent.input.accepted', {
      source: 'text',
      disposition: 'agent',
    }),
    event('engine.agent.run.started', { disposition: 'agent' }),
    event('engine.agent.turn.started', { turnId, turnIndex: 1 }),
    event('engine.agent.tool.started', {
      turnId,
      callId: 'call-1',
      toolName: 'lookup',
    }),
    event('engine.agent.tool.completed', {
      turnId,
      callId: 'call-1',
      toolName: 'lookup',
      outcome: 'succeeded',
      durationMs: 7,
    }),
    event('engine.agent.turn.finished', {
      turnId,
      turnIndex: 1,
      toolCalls: 1,
      inputTokens: 10,
      outputTokens: 5,
    }),
    event('engine.planner.completed', { turnId, durationMs: 12 }),
    event('engine.agent.run.finished', finished('completed', 'succeeded')),
  ]);
  expect(run).toMatchObject({
    key: JSON.stringify(['app', 'run-1']),
    clientId: 'app',
    runId: 'run-1',
    inputId: 'input-1',
    disposition: 'agent',
    status: 'completed',
    outcome: 'succeeded',
    durationMs: 42,
    metrics: {
      turns: 1,
      toolCalls: 1,
      elapsedMs: 42,
      inputTokens: 10,
      outputTokens: 5,
    },
    missingStart: false,
    lastIndex: 7,
  });
  expect(run.events).toHaveLength(8);
  expect(run.turns.map((turn) => turn.turnId)).toEqual([turnId]);
  expect(run.turns[0]!.events.map((entry) => entry.kind)).toEqual([
    'engine.agent.turn.started',
    'engine.agent.tool.started',
    'engine.agent.tool.completed',
    'engine.agent.turn.finished',
    'engine.planner.completed',
  ]);
});

test('each run.finished reason maps to its status and an unfinished run is queued or running', () => {
  const cases = [
    { reason: 'completed', outcome: 'succeeded', extra: {} },
    { reason: 'budget', outcome: 'failed', extra: { limit: 'turns' } },
    { reason: 'error', outcome: 'failed', extra: { code: 'provider_error' } },
    { reason: 'cancelled', outcome: 'failed', extra: {} },
  ];
  for (const { reason, outcome, extra } of cases) {
    const event = runOwned(`run-${reason}`, `input-${reason}`);
    const run = onlyRun([
      event('engine.agent.input.accepted', {
        source: 'text',
        disposition: 'agent',
      }),
      event('engine.agent.run.started', { disposition: 'agent' }),
      event('engine.agent.run.finished', finished(reason, outcome, extra)),
    ]);
    expect({
      status: run.status,
      outcome: run.outcome,
      code: run.code,
      limit: run.limit,
    }).toEqual({
      status: reason as AgentRunTrace['status'],
      outcome,
      code: 'code' in extra ? extra.code : undefined,
      limit: 'limit' in extra ? extra.limit : undefined,
    });
  }
  const queued = runOwned('run-queued', 'input-queued');
  expect(
    onlyRun([
      queued('engine.agent.input.accepted', {
        source: 'text',
        disposition: 'agent',
      }),
    ]).status,
  ).toBe('queued');
  const running = runOwned('run-running', 'input-running');
  expect(
    onlyRun([
      running('engine.agent.input.accepted', {
        source: 'text',
        disposition: 'agent',
      }),
      running('engine.agent.turn.started', {
        turnId: 'run-running:t1',
        turnIndex: 1,
      }),
    ]).status,
  ).toBe('running');
});

test('run.finished fallbacks fill duration, keep an unknown reason finished and reject invalid counters', () => {
  const { reason: _reason, durationMs: _durationMs, ...metrics } = finished(
    'completed',
    'succeeded',
  );
  const cases: {
    name: string;
    metadata: Record<string, unknown>;
    expected: {
      status: AgentRunTrace['status'];
      durationMs: number;
      inputTokens?: undefined;
      outputTokens?: undefined;
    };
  }[] = [
    {
      name: 'elapsedMs without durationMs',
      metadata: { ...metrics, reason: 'completed' },
      expected: { status: 'completed', durationMs: 42 },
    },
    {
      name: 'unexpected reason',
      metadata: { ...metrics, reason: 'unexpected' },
      expected: { status: 'finished', durationMs: 42 },
    },
    {
      name: 'absent reason',
      metadata: { ...metrics, durationMs: 42 },
      expected: { status: 'finished', durationMs: 42 },
    },
    {
      name: 'invalid token counters',
      metadata: {
        ...metrics,
        reason: 'completed',
        inputTokens: -1,
        outputTokens: '5',
      },
      expected: {
        status: 'completed',
        durationMs: 42,
        inputTokens: undefined,
        outputTokens: undefined,
      },
    },
  ];
  for (const { name, metadata, expected } of cases) {
    const event = runOwned(`run-${name}`, `input-${name}`);
    const run = onlyRun([
      event('engine.agent.input.accepted', {
        source: 'text',
        disposition: 'agent',
      }),
      event('engine.agent.run.started', { disposition: 'agent' }),
      event('engine.agent.run.finished', metadata),
    ]);
    expect({
      name,
      status: run.status,
      outcome: run.outcome,
      durationMs: run.durationMs,
      inputTokens: run.metrics?.inputTokens,
      outputTokens: run.metrics?.outputTokens,
    }).toEqual({
      name,
      outcome: 'succeeded',
      inputTokens: 10,
      outputTokens: 5,
      ...expected,
    });
  }
});

test('a group whose first retained run event is not input.accepted is missing its start', () => {
  const event = runOwned('run-1', 'input-1');
  const run = onlyRun([
    event('engine.agent.run.started', { disposition: 'agent' }),
    event('engine.agent.run.finished', finished('completed', 'succeeded')),
  ]);
  expect(run.missingStart).toBe(true);
  expect(run.status).toBe('completed');
});

test('a queued run cancelled before starting is a valid group and not missing its start', () => {
  const event = runOwned('run-1', 'input-1');
  const run = onlyRun([
    event('engine.agent.input.accepted', {
      source: 'text',
      disposition: 'agent',
    }),
    event(
      'engine.agent.run.finished',
      finished('cancelled', 'failed', { turns: 0, toolCalls: 0 }),
    ),
  ]);
  expect(run).toMatchObject({ status: 'cancelled', missingStart: false });
});

test('a ui_only run groups the same way as an agent run', () => {
  const event = runOwned('run-ui', 'input-ui');
  const run = onlyRun([
    event('engine.agent.input.accepted', {
      source: 'voice',
      disposition: 'ui_only',
    }),
    event('engine.planner.started'),
    event('engine.stage.completed', { stage: 'plan', durationMs: 3 }),
    event('engine.planner.completed', { durationMs: 9 }),
    event('engine.agent.ui_change.emitted', {
      changeId: 'change-1',
      actions: 1,
    }),
    event('engine.agent.ui_change.applied', {
      changeId: 'change-1',
      actions: 1,
      failed: 0,
    }),
    event(
      'engine.agent.run.finished',
      finished('completed', 'succeeded', { turns: 0, toolCalls: 0 }),
    ),
  ]);
  expect(run).toMatchObject({
    runId: 'run-ui',
    inputId: 'input-ui',
    disposition: 'ui_only',
    status: 'completed',
    missingStart: false,
  });
  expect(run.events).toHaveLength(7);
  expect(run.turns).toEqual([]);
});

test('the same runId from two clients gives two groups', () => {
  const a = runOwned('run-1', 'input-1', 'app-a');
  const b = runOwned('run-1', 'input-1', 'app-b');
  const { runs } = groupAgentRuns(
    panelEvents([
      a('engine.agent.input.accepted', {
        source: 'text',
        disposition: 'agent',
      }),
      b('engine.agent.input.accepted', {
        source: 'text',
        disposition: 'agent',
      }),
    ]),
  );
  expect(runs.map((run) => run.key).sort()).toEqual(
    [
      JSON.stringify(['app-a', 'run-1']),
      JSON.stringify(['app-b', 'run-1']),
    ].sort(),
  );
});

test('client events wait in the session timeline until their engine event arrives', () => {
  const event = runOwned('run-1', 'input-1');
  const sent = session('client.agent.input.sent', { inputId: 'input-1' });
  const accepted = event('engine.agent.input.accepted', {
    source: 'text',
    disposition: 'agent',
  });
  const before = groupAgentRuns(panelEvents([sent]));
  expect(before.runs).toEqual([]);
  expect(
    before.sessionTimelines.map((timeline) => ({
      clientId: timeline.clientId,
      kinds: timeline.events.map((entry) => entry.kind),
    })),
  ).toEqual([{ clientId: 'app', kinds: ['client.agent.input.sent'] }]);

  const after = groupAgentRuns(panelEvents([sent, accepted]));
  expect(after.sessionTimelines).toEqual([]);
  expect(after.runs[0]!.events.map((entry) => entry.kind)).toEqual([
    'client.agent.input.sent',
    'engine.agent.input.accepted',
  ]);
  expect(after.runs[0]!.missingStart).toBe(false);

  const applied = session('client.agent.ui.applied', {
    changeId: 'change-1',
    durationMs: 4,
  });
  const emitted = event('engine.agent.ui_change.emitted', {
    changeId: 'change-1',
    actions: 1,
  });
  expect(
    groupAgentRuns(
      panelEvents([accepted, applied]),
    ).sessionTimelines[0]!.events.map((entry) => entry.kind),
  ).toEqual(['client.agent.ui.applied']);
  const linked = groupAgentRuns(panelEvents([accepted, applied, emitted]));
  expect(linked.sessionTimelines).toEqual([]);
  expect(linked.runs[0]!.events.map((entry) => entry.kind)).toEqual([
    'engine.agent.input.accepted',
    'client.agent.ui.applied',
    'engine.agent.ui_change.emitted',
  ]);
});

test('a reused inputId links the client event to the newest run', () => {
  const older = runOwned('run-old', 'input-1');
  const newer = runOwned('run-new', 'input-1');
  const { runs, sessionTimelines } = groupAgentRuns(
    panelEvents([
      older('engine.agent.input.accepted', {
        source: 'text',
        disposition: 'agent',
      }),
      session('client.agent.input.sent', { inputId: 'input-1' }),
      newer('engine.agent.input.accepted', {
        source: 'text',
        disposition: 'agent',
      }),
    ]),
  );
  expect(sessionTimelines).toEqual([]);
  const byRun = new Map(runs.map((run) => [run.runId, run]));
  expect(byRun.get('run-old')!.events.map((entry) => entry.kind)).toEqual([
    'engine.agent.input.accepted',
  ]);
  expect(byRun.get('run-new')!.events.map((entry) => entry.kind)).toEqual([
    'client.agent.input.sent',
    'engine.agent.input.accepted',
  ]);
});

test('a reused changeId links the client ui.applied event to the newest run', () => {
  const older = runOwned('run-old', 'input-1');
  const newer = runOwned('run-new', 'input-2');
  const { runs, sessionTimelines } = groupAgentRuns(
    panelEvents([
      older('engine.agent.ui_change.emitted', {
        changeId: 'change-1',
        actions: 1,
      }),
      newer('engine.agent.ui_change.emitted', {
        changeId: 'change-1',
        actions: 1,
      }),
      session('client.agent.ui.applied', {
        changeId: 'change-1',
        durationMs: 3,
      }),
    ]),
  );
  expect(sessionTimelines).toEqual([]);
  const byRun = new Map(runs.map((run) => [run.runId, run]));
  expect(byRun.get('run-old')!.events.map((entry) => entry.kind)).toEqual([
    'engine.agent.ui_change.emitted',
  ]);
  expect(byRun.get('run-new')!.events.map((entry) => entry.kind)).toEqual([
    'engine.agent.ui_change.emitted',
    'client.agent.ui.applied',
  ]);
});

test('session-level agent events stay in their client session timeline and a known rejected acknowledgement joins its run', () => {
  const event = runOwned('run-1', 'input-1');
  const other = (kind: string, metadata: Record<string, unknown>) =>
    observation(kind, { clientId: 'other-app' }, metadata);
  const { runs, sessionTimelines } = groupAgentRuns(
    panelEvents([
      session('engine.agent.input.ignored', {
        inputId: 'input-0',
        reason: 'duplicate_input',
      }),
      session('engine.agent.input.rejected', { code: 'queue_full' }),
      session('engine.agent.ui_change.emitted', {
        changeId: 'change-session',
        actions: 1,
      }),
      session('engine.agent.input.accepted', {
        inputId: 'input-noise',
        source: 'voice',
        disposition: 'noise',
      }),
      session('engine.agent.ui_applied.rejected', {
        changeId: 'change-unknown',
        code: 'unknown_change',
      }),
      other('engine.agent.input.rejected', {
        code: 'invalid_input',
        inputId: 'input-x',
      }),
      event('engine.agent.input.accepted', {
        source: 'text',
        disposition: 'ui_only',
      }),
      event('engine.agent.ui_change.emitted', {
        changeId: 'change-1',
        actions: 2,
      }),
      session('engine.agent.ui_applied.rejected', {
        changeId: 'change-1',
        code: 'invalid_action_outcomes',
      }),
      observation('engine.agent.input.accepted', { requestId: 'request-1' }),
      observation(
        'engine.agent.turn.started',
        { runId: 'run-1', requestId: 'request-2' },
        { inputId: 'input-1', turnId: 'run-1:t1', turnIndex: 1 },
      ),
    ]),
  );
  const grouped = [
    ...runs.flatMap((run) => run.events),
    ...sessionTimelines.flatMap((timeline) => timeline.events),
  ];
  expect(grouped.filter((entry) => entry.raw.requestId)).toEqual([]);
  expect(
    sessionTimelines.map((timeline) => ({
      clientId: timeline.clientId,
      kinds: timeline.events.map((entry) => entry.kind),
    })),
  ).toEqual([
    {
      clientId: 'app',
      kinds: [
        'engine.agent.input.ignored',
        'engine.agent.input.rejected',
        'engine.agent.ui_change.emitted',
        'engine.agent.input.accepted',
        'engine.agent.ui_applied.rejected',
      ],
    },
    { clientId: 'other-app', kinds: ['engine.agent.input.rejected'] },
  ]);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.events.map((entry) => entry.kind)).toEqual([
    'engine.agent.input.accepted',
    'engine.agent.ui_change.emitted',
    'engine.agent.ui_applied.rejected',
  ]);
  expect(runs[0]!.status).toBe('running');
});

test('an event reporting a redacted runId joins no run group and no session timeline', () => {
  const event = runOwned('run-1', 'input-1');
  const accepted = event('engine.agent.input.accepted', {
    source: 'text',
    disposition: 'agent',
  });
  const redactedSent = observation(
    'client.agent.input.sent',
    { runId: '[REDACTED]' },
    { inputId: 'input-1' },
  );
  const redactedTurn = observation(
    'engine.agent.turn.started',
    { runId: '[REDACTED]' },
    { inputId: 'input-1', turnId: 'run-1:t1', turnIndex: 1 },
  );
  const linked = groupAgentRuns(panelEvents([accepted, redactedSent]));
  expect(
    linked.runs.map((run) => run.events.map((entry) => entry.kind)),
  ).toEqual([['engine.agent.input.accepted']]);
  expect(linked.sessionTimelines).toEqual([]);

  const alone = groupAgentRuns(panelEvents([redactedTurn]));
  expect(alone).toEqual({ runs: [], sessionTimelines: [] });
});

test('a session-owned ui change does not register a link for later acknowledgements', () => {
  const { runs, sessionTimelines } = groupAgentRuns(
    panelEvents([
      session('engine.agent.ui_change.emitted', {
        changeId: 'change-1',
        actions: 1,
      }),
      session('client.agent.ui.applied', {
        changeId: 'change-1',
        durationMs: 2,
      }),
    ]),
  );
  expect(runs).toEqual([]);
  expect(sessionTimelines[0]!.events).toHaveLength(2);
});

test('request grouping is unchanged by run and session events', () => {
  const request = (kind: string, metadata: Record<string, unknown> = {}) =>
    observation(kind, { requestId: 'request-1' }, metadata);
  const event = runOwned('run-1', 'input-1');
  const requestEvents = [
    request('client.request.started'),
    request('engine.planner.completed', { durationMs: 5 }),
    request('client.response.received', { source: 'request', durationMs: 8 }),
    request('client.response.applied', { durationMs: 2 }),
  ];
  const mixed = [
    event('engine.agent.input.accepted', {
      source: 'text',
      disposition: 'agent',
    }),
    requestEvents[0],
    event('engine.planner.completed', { durationMs: 9 }),
    session('engine.agent.input.rejected', { code: 'queue_full' }),
    requestEvents[1],
    session('client.agent.input.sent', { inputId: 'input-2' }),
    requestEvents[2],
    requestEvents[3],
    event('engine.agent.run.finished', finished('completed', 'succeeded')),
  ];
  const strip = (traces: ReturnType<typeof groupRequests>) =>
    traces.map(({ events, lastIndex: _lastIndex, ...rest }) => ({
      ...rest,
      engineTimings: rest.engineTimings.map(({ eventKey: _key, ...t }) => t),
      events: events.map((entry) => entry.raw),
    }));
  expect(strip(groupRequests(panelEvents(mixed)))).toEqual(
    strip(groupRequests(panelEvents(requestEvents))),
  );
});
