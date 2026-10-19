import { expect, test } from 'bun:test';
import { DiagnosticCapture } from './capture.js';
import {
  eventLabel,
  groupRequests,
  inspectState,
  panelEvents,
  recordingEvidence,
  requestEventCoverage,
  requestPhases,
  requestTimingComparison,
} from './panel-model.js';

function event(
  kind: string,
  clientId = 'app-a',
  requestId = 'request',
  metadata: Record<string, unknown> = {},
  content?: unknown,
) {
  return {
    id: crypto.randomUUID(),
    kind,
    at: 100,
    sessionId: 'shared-session',
    requestId,
    metadata: { clientId, ...metadata },
    content,
  };
}

test('request comparison leaves missing and push timings unknown and never combines nested server work', () => {
  const requests = groupRequests(
    panelEvents([
      event('client.response.received', 'app-a', 'first', {
        source: 'request',
        durationMs: 0,
      }),
      event('client.response.applied', 'app-a', 'first', { durationMs: 12 }),
      event('engine.request.completed', 'app-a', 'first', {
        durationMs: 300,
        serverAt: 9999,
      }),
      event('engine.stage.completed', 'app-a', 'first', {
        durationMs: 80,
        stage: 'plan',
      }),
      event('client.response.received', 'app-b', 'second', {
        source: 'push',
        durationMs: 50,
      }),
      event('client.response.applied', 'app-b', 'second'),
    ]),
  );
  const a = requests.find((request) => request.clientId === 'app-a')!;
  const b = requests.find((request) => request.clientId === 'app-b')!;
  expect(requestTimingComparison(a, b)).toEqual([
    { label: 'Request round-trip', aMs: 0, bMs: undefined, deltaMs: undefined },
    {
      label: 'Client application',
      aMs: 12,
      bMs: undefined,
      deltaMs: undefined,
    },
  ]);
  expect(
    requestTimingComparison(a, undefined).every(
      (row) => row.deltaMs === undefined,
    ),
  ).toBe(true);
});

test('comparison counts every observed attempt and reused Action ID without inventing counterparts', () => {
  const [a] = groupRequests(
    panelEvents([
      event('engine.stage.failed'),
      event('engine.stage.failed'),
      event('engine.stage.completed'),
      event('client.action.completed', 'app-a', 'request', {
        action: 'open',
        toolCallId: 'same',
        outcome: 'succeeded',
      }),
      event('client.action.completed', 'app-a', 'request', {
        action: 'open',
        toolCallId: 'same',
        outcome: 'failed',
      }),
    ]),
  );
  const [b] = groupRequests(
    panelEvents([
      event('engine.stage.completed'),
      event('client.action.completed', 'app-a', 'request', {
        action: 'open',
        toolCallId: 'same',
        outcome: 'succeeded',
      }),
    ]),
  );
  expect(requestEventCoverage(a, b)).toEqual([
    { kind: 'engine.stage.failed', a: 2, b: 0 },
    { kind: 'engine.stage.completed', a: 1, b: 1 },
    { kind: 'client.action.completed', a: 2, b: 1 },
  ]);
});

test('phase measurements preserve independent attempts and never infer elapsed time from event clocks', () => {
  const events = panelEvents([
    {
      ...event('client.request.started'),
      at: 100,
      metadata: { clientId: 'app-a', durationMs: 999 },
    },
    event('engine.stage.failed', 'app-a', 'request', {
      stage: 'plan',
      outcome: 'failed',
      durationMs: 5,
      serverAt: 900000,
    }),
    event('engine.stage.completed', 'app-a', 'request', {
      stage: 'plan',
      outcome: 'succeeded',
      durationMs: 7,
      serverAt: 2,
    }),
    event('client.response.received', 'app-a', 'request', {
      source: 'request',
      durationMs: 40,
    }),
    event('client.command.completed', 'app-a', 'request', {
      command: 'set_layout',
      durationMs: 3,
    }),
    event('client.action.completed', 'app-a', 'request', {
      outcome: 'skipped',
    }),
    {
      ...event('client.response.applied', 'app-a', 'request', {
        durationMs: 12,
        actionFailures: 0,
        skippedActions: 1,
      }),
      at: 999999,
    },
  ]);
  const phases = requestPhases(groupRequests(events)[0]);
  expect(
    phases.map(({ lane, outcome, durationMs }) => [lane, outcome, durationMs]),
  ).toEqual([
    ['Client request', 'Started', undefined],
    ['Engine stage', 'Failed', 5],
    ['Engine stage', 'Succeeded', 7],
    ['Client request', 'Succeeded', 40],
    ['Command', 'Completed', 3],
    ['Action', 'Skipped', undefined],
    ['Client application', 'Applied with Action issues', 12],
  ]);
  expect(phases.map((phase) => phase.eventKey)).toEqual(
    events.map((item) => item.key),
  );
});

test('phase timings retain measured readiness waits without inventing missing or invalid durations', () => {
  const [request] = groupRequests(
    panelEvents([
      event('client.action.ready', 'app-a', 'request', { durationMs: 123 }),
      event('client.action.unavailable', 'app-a', 'request', {
        durationMs: 2500,
      }),
      event('client.action.ready', 'app-a', 'request', { durationMs: -1 }),
      event('client.action.unavailable'),
      event('client.action.waiting', 'app-a', 'request', { durationMs: 900 }),
    ]),
  );
  expect(requestPhases(request).map((phase) => phase.durationMs)).toEqual([
    123,
    2500,
    undefined,
    undefined,
    undefined,
  ]);
});

test('candidate validation phases preserve rejected and accepted attempts without guessing absent outcomes', () => {
  const [request] = groupRequests(
    panelEvents([
      event('engine.candidate.validated', 'app-a', 'request', {
        outcome: 'failed',
      }),
      event('engine.candidate.validated', 'app-a', 'request', {
        outcome: 'succeeded',
      }),
      event('engine.candidate.validated'),
      event('engine.candidate.validated', 'app-a', 'request', {
        outcome: 'unexpected',
      }),
    ]),
  );
  expect(requestPhases(request).map((phase) => phase.outcome)).toEqual([
    'Failed',
    'Succeeded',
    'Not reported',
    'Not reported',
  ]);
});

test('a cancelled planner attempt is not relabelled as a failure in the phase view', () => {
  const [request] = groupRequests(
    panelEvents([
      event('engine.planner.failed', 'app-a', 'request', {
        outcome: 'cancelled',
      }),
    ]),
  );
  expect(requestPhases(request)[0].outcome).toBe('Cancelled');
});

test('equal request IDs from different app lifetimes never become one request', () => {
  const requests = groupRequests(
    panelEvents([
      event('client.request.started'),
      event('client.request.started', 'app-b'),
      event('client.response.applied', 'app-a', 'request', {
        actionFailures: 0,
        skippedActions: 0,
      }),
      event('client.request.failed', 'app-b'),
    ]),
  );
  expect(requests).toHaveLength(2);
  expect(requests.find((r) => r.clientId === 'app-a')?.status).toBe('applied');
  expect(requests.find((r) => r.clientId === 'app-b')?.status).toBe('failed');
});

test('receipt and Engine completion do not claim that the UI applied a response', () => {
  const [request] = groupRequests(
    panelEvents([
      event('client.request.started'),
      event('engine.request.completed', 'app-a', 'request', {
        durationMs: 80,
        serverAt: 999999,
      }),
      event('client.response.received', 'app-a', 'request', { durationMs: 12 }),
    ]),
  );
  expect(request.status).toBe('received');
  expect(request.transportMs).toBe(12);
  expect(request.applicationMs).toBeUndefined();
});

test('whole application time stays separate from nested command work and server clocks', () => {
  const [request] = groupRequests(
    panelEvents([
      event('client.request.started'),
      event('engine.request.completed', 'app-a', 'request', {
        durationMs: 80,
        serverAt: 999999,
      }),
      event('client.response.received', 'app-a', 'request', {
        durationMs: 100,
      }),
      event('client.command.completed', 'app-a', 'request', { durationMs: 4 }),
      event('client.command.completed', 'app-a', 'request', { durationMs: 6 }),
      event('client.response.applied', 'app-a', 'request', {
        durationMs: 35,
        actionFailures: 0,
        skippedActions: 0,
      }),
    ]),
  );
  expect(request.applicationMs).toBe(35);
  expect(request.commandMs).toBe(10);
  expect(request.transportMs).toBe(100);
});

test('Engine timing retains repeated attempts without adding nested stages together', () => {
  const [request] = groupRequests(
    panelEvents([
      event('engine.stage.completed', 'app-a', 'request', {
        stage: 'validate',
        durationMs: 3,
      }),
      event('engine.stage.failed', 'app-a', 'request', {
        stage: 'plan',
        durationMs: 5,
      }),
      event('engine.stage.completed', 'app-a', 'request', {
        stage: 'plan',
        durationMs: 7,
      }),
      event('engine.planner.completed', 'app-a', 'request', { durationMs: 20 }),
      event('engine.request.completed', 'app-a', 'request', { durationMs: 30 }),
    ]),
  );
  expect(
    request.engineTimings.map(({ label, durationMs }) => [label, durationMs]),
  ).toEqual([
    ['Stage: validate', 3],
    ['Stage: plan', 5],
    ['Stage: plan', 7],
    ['Planning', 20],
    ['Engine request', 30],
  ]);
  expect(request.applicationMs).toBeUndefined();
  expect(request.transportMs).toBeUndefined();
});

test('legacy and invalid durations leave whole application time unknown', () => {
  const [legacy] = groupRequests(
    panelEvents([
      event('client.command.completed', 'app-a', 'request', { durationMs: 8 }),
      event('client.response.applied'),
    ]),
  );
  expect(legacy.applicationMs).toBeUndefined();
  expect(legacy.commandMs).toBe(8);
  const [failed] = groupRequests(
    panelEvents([
      event('client.response.failed', 'app-a', 'request', { durationMs: 12 }),
    ]),
  );
  expect(failed.applicationMs).toBe(12);
  const [invalid] = groupRequests(
    panelEvents([
      event('client.response.applied', 'app-a', 'request', { durationMs: -1 }),
      event('engine.planner.completed', 'app-a', 'request', {
        durationMs: '10',
      }),
    ]),
  );
  expect(invalid.applicationMs).toBeUndefined();
  expect(invalid.engineTimings[0].durationMs).toBeUndefined();
});

test('a completed response keeps skipped and failed Actions visible', () => {
  const [request] = groupRequests(
    panelEvents([
      event('client.request.started'),
      event('client.action.completed', 'app-a', 'request', {
        outcome: 'skipped',
      }),
      event('client.response.applied', 'app-a', 'request', {
        actionFailures: 1,
        skippedActions: 1,
      }),
    ]),
  );
  expect(request.status).toBe('applied-with-issues');
  expect(request.failedActions).toBe(1);
  expect(request.skippedActions).toBe(1);
  expect(request.succeededActions).toBe(0);
});

test('a retried Engine failure cannot override a later client application outcome', () => {
  const [request] = groupRequests(
    panelEvents([
      event('client.request.started'),
      event('engine.planner.failed'),
      event('client.response.applied', 'app-a', 'request', {
        actionFailures: 0,
        skippedActions: 0,
      }),
    ]),
  );
  expect(request.status).toBe('applied');
});

test('structured issues explain failures without recasting cancellation or recovered attempts as request failure', () => {
  const [request] = groupRequests(
    panelEvents([
      event('engine.stage.failed', 'app-a', 'request', {
        outcome: 'failed',
        errorCategory: 'timeout',
      }),
      event('client.action.completed', 'app-a', 'request', {
        outcome: 'skipped',
        errorCategory: 'readiness',
      }),
      event('client.action.completed', 'app-a', 'request', {
        outcome: 'unknown',
        errorCategory: 'new-category',
      }),
      event('client.response.applied', 'app-a', 'request', {
        actionFailures: 0,
        skippedActions: 1,
      }),
    ]),
  );
  expect(
    request.issues.map(({ outcome, category }) => [outcome, category]),
  ).toEqual([
    ['failed', 'timeout'],
    ['skipped', 'readiness'],
    ['unknown', undefined],
  ]);
  expect(request.status).toBe('applied-with-issues');
  const [cancelled] = groupRequests(
    panelEvents([
      event('client.request.failed', 'app-a', 'cancelled', {
        outcome: 'cancelled',
        errorCategory: 'timeout',
      }),
    ]),
  );
  expect(cancelled.issues).toEqual([]);
  expect(cancelled.status).toBe('cancelled');
});

test('diagnostic-only failures remain discoverable when a partial recording lacks an operational outcome', () => {
  const [request] = groupRequests(
    panelEvents([
      event('client.command.failed'),
      event('engine.candidate.validated', 'app-a', 'request', {
        outcome: 'failed',
      }),
      event('engine.candidate.validated', 'app-a', 'request', {
        outcome: 'succeeded',
      }),
      event('engine.planner.failed', 'app-a', 'request', {
        outcome: 'cancelled',
      }),
    ]),
  );
  expect(
    request.issues.map(({ outcome, category }) => [outcome, category]),
  ).toEqual([
    ['failed', undefined],
    ['failed', undefined],
  ]);
  expect(request.status).toBe('awaiting');
});

test('missing request starts stay visible as partial evidence, while push responses need no start', () => {
  const [partial] = groupRequests(
    panelEvents([event('client.response.applied')]),
  );
  expect(partial.missingStart).toBe(true);
  const [push] = groupRequests(
    panelEvents([
      event('client.response.received', 'app-a', 'push', { source: 'push' }),
      event('client.response.applied', 'app-a', 'push'),
    ]),
  );
  expect(push.missingStart).toBe(false);
  expect(push.push).toBe(true);
});

test('events without app identity remain available without invented request correlation', () => {
  const events = panelEvents([
    { kind: 'engine_request', requestId: 'legacy', sessionId: 'same' },
  ]);
  expect(events).toHaveLength(1);
  expect(groupRequests(events)).toEqual([]);
});

test('redacted and truncated identities cannot merge unrelated request traces', () => {
  const projected = panelEvents([
    event('client.request.started', '[REDACTED]'),
    event('client.response.applied', '[REDACTED]'),
    event('client.request.started', 'app-a', 'same-prefix[TRUNCATED]'),
  ]);
  expect(projected).toHaveLength(3);
  expect(groupRequests(projected)).toEqual([]);
});

test.each([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
])('capture string limit %i cannot invent shared app or request identities', (maxStringCharacters) => {
  const capture = new DiagnosticCapture(() => null, { maxStringCharacters });
  capture.start('fixture');
  for (const suffix of ['first', 'second'])
    capture.record('event', {
      requestId: `a-long-distinct-request-${suffix}`,
      metadata: { clientId: `a-long-distinct-app-${suffix}` },
    });
  const evidence = recordingEvidence(JSON.parse(capture.export()));
  expect(evidence.apps).toEqual([]);
  expect(groupRequests(evidence.events)).toEqual([]);
});

test('retained event identities survive buffer eviction without selecting newer evidence', () => {
  const first = event('fixture.first');
  const selected = event('fixture.selected');
  const before = panelEvents([first, selected]);
  const after = panelEvents([selected, event('fixture.newest')]);
  expect(after.find((item) => item.key === before[1].key)?.raw.id).toBe(
    selected.id,
  );
  const duplicates = panelEvents([selected, selected, { kind: 'legacy' }]);
  expect(new Set(duplicates.map((item) => item.key)).size).toBe(3);
});

test('unknown event names cannot become outcomes through object prototype properties', () => {
  const [request] = groupRequests(
    panelEvents([
      event('client.request.started'),
      event('toString'),
      event('__proto__'),
    ]),
  );
  expect(request.status).toBe('awaiting');
});

const baseline = {
  snapshot: {
    connection: 'connected',
    chart: { columns: 8, rows: 4 },
    layout: {
      type: 'tiling',
      tree: ['V:1,3', 'ID:a', 'ID:b'],
      instances: [
        { instanceId: 'a', vesselId: 'counter', variant: 'main' },
        { instanceId: 'b', vesselId: 'counter', variant: 'main' },
      ],
    },
  },
  vessels: [
    {
      id: 'counter',
      name: 'Counter',
      variants: {
        main: {
          minSize: { width: 1, height: 1 },
          actions: [{ name: 'increment', description: 'Increment counter' }],
        },
      },
    },
  ],
};

test('the Inspector uses Chart dimensions and the actual weighted split', () => {
  const state = inspectState(baseline);
  expect(
    state.tiles?.map((tile) => [tile.instanceId, tile.x, tile.width]),
  ).toEqual([
    ['a', 0, 25],
    ['b', 25, 75],
  ]);
  expect(state.columns).toBe(8);
  expect(state.rows).toBe(4);
  expect(state.instances[0].actions[0].name).toBe('increment');
});

test('an invalid imported layout does not manufacture geometry or hidden-instance claims', () => {
  const state = inspectState({
    layout: {
      type: 'tiling',
      tree: ['V', 'ID:a'],
      instances: [{ instanceId: 'a', vesselId: 'counter', variant: 'main' }],
    },
  });
  expect(state.tiles).toBeNull();
  expect(state.instances[0].visible).toBeUndefined();
});

test('omitted tiling leaves are retained Instances with explicit hidden visibility', () => {
  const state = inspectState({
    ...baseline,
    snapshot: {
      ...baseline.snapshot,
      layout: { ...baseline.snapshot.layout, tree: ['ID:a'] },
    },
  });
  expect(state.instances.find((i) => i.instanceId === 'b')?.visible).toBe(
    false,
  );
});

test('older recordings preserve hidden declarations while current visible variants override old layout declarations', () => {
  const state = inspectState({
    ...baseline,
    snapshot: {
      ...baseline.snapshot,
      layout: { ...baseline.snapshot.layout, tree: ['ID:a'] },
      instances: {
        instances: [
          { instanceId: 'a', vesselId: 'counter', variant: 'updated' },
        ],
      },
    },
  });
  expect(
    state.instances.map((item) => [
      item.instanceId,
      item.variant,
      item.visible,
    ]),
  ).toEqual([
    ['a', 'updated', true],
    ['b', 'main', false],
  ]);
});

test('recorded structural evidence advances per app while retaining its captured definitions', () => {
  const evidence = recordingEvidence({
    schemaVersion: 2,
    capture: {
      schemaVersion: 1,
      metadata: { scope: 'provider', providerInstanceId: 'app-a' },
      outcome: 'Reproduce this',
      droppedEvents: 2,
      events: [
        event('client.snapshot', 'app-a', undefined, {}, baseline),
        event(
          'client.response.applied',
          'app-a',
          'request',
          {},
          {
            layoutMode: 'tiling',
            chartDimensions: { columns: 4, rows: 2 },
            layout: {
              type: 'tiling',
              tree: ['ID:a'],
              instances: [
                { instanceId: 'a', vesselId: 'counter', variant: 'main' },
              ],
            },
          },
        ),
      ],
    },
  });
  expect(evidence.apps).toHaveLength(1);
  expect(evidence.apps[0].active).toBeUndefined();
  const state = inspectState(evidence.apps[0].inspection);
  expect(state.instances).toHaveLength(1);
  expect(state.instances[0].actions[0].name).toBe('increment');
  expect(state.columns).toBe(4);
  expect(evidence.dropped).toBe(2);
  expect(evidence.note).toBe('Reproduce this');
});

test('recorded Chart resizing updates only its app geometry without losing capabilities', () => {
  const grid = {
    ...baseline,
    snapshot: {
      ...baseline.snapshot,
      layout: {
        type: 'grid',
        positions: [
          {
            instanceId: 'a',
            position: { column: 0, row: 0 },
            size: { width: 4, height: 2 },
          },
        ],
      },
      instances: [{ instanceId: 'a', vesselId: 'counter', variant: 'main' }],
    },
  };
  const evidence = recordingEvidence({
    events: [
      event('client.snapshot', 'app-a', undefined, {}, grid),
      event('client.snapshot', 'app-b', undefined, {}, grid),
      event(
        'client.chart.resized',
        'app-a',
        undefined,
        {},
        {
          columns: 16,
          rows: 8,
        },
      ),
    ],
  });
  const resized = inspectState(evidence.apps[0].inspection);
  const unchanged = inspectState(evidence.apps[1].inspection);
  expect([resized.columns, resized.rows]).toEqual([16, 8]);
  expect(resized.tiles).toEqual([
    { instanceId: 'a', x: 0, y: 0, width: 25, height: 25 },
  ]);
  expect(resized.instances[0].actions[0].name).toBe('increment');
  expect(resized.layout).toEqual(grid.snapshot.layout);
  expect([unchanged.columns, unchanged.rows]).toEqual([8, 4]);
  expect(unchanged.tiles?.[0].width).toBe(50);
});

test('malformed or redacted projections remain readable as unavailable evidence', () => {
  expect(inspectState('[REDACTED]').instances).toEqual([]);
  expect(
    recordingEvidence({
      capture: { events: [null, 'unrecognized', { kind: 'fixture' }] },
    }).events,
  ).toHaveLength(1);
});

test('cancelled request evidence stays distinct from a failed request in the panel', () => {
  const events = panelEvents([
    event('client.request.started'),
    event('client.request.failed', 'app-a', 'request', {
      outcome: 'cancelled',
      reason: 'disposed',
    }),
  ]);
  expect(groupRequests(events)[0]?.status).toBe('cancelled');
  expect(eventLabel(events[1])).toBe('Request cancelled');
});
