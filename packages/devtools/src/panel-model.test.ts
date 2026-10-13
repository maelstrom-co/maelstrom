import { expect, test } from 'bun:test';
import { DiagnosticCapture } from './capture.js';
import {
  eventLabel,
  groupRequests,
  inspectState,
  panelEvents,
  recordingEvidence,
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
