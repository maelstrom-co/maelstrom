import { expect, test } from 'bun:test';
import { panelEvents, recordingEvidence } from './panel-model.js';
import { requestOverview } from './request-overview.js';

function event(
  id: string,
  clientId: string,
  kind: string,
  metadata: Record<string, unknown> = {},
  requestId = 'same',
  at = 100,
) {
  return {
    id,
    kind,
    requestId,
    at,
    sessionId: `session-${clientId}`,
    metadata: { clientId, ...metadata },
  };
}
function evidence(events: unknown[]) {
  return { events: panelEvents(events), apps: [], omitted: 0, metadata: {} };
}

test('reported round trips remain separate for app instances and exclude nested application and Engine work', () => {
  const view = requestOverview(
    evidence([
      event('a-start', 'a', 'client.request.started'),
      event('a-response', 'a', 'client.response.received', {
        source: 'request',
        durationMs: 25,
      }),
      event('a-engine', 'a', 'engine.request.completed', { durationMs: 900 }),
      event('a-end', 'a', 'client.response.applied', {
        durationMs: 5,
        actionFailures: 0,
        skippedActions: 0,
      }),
      event('b-start', 'b', 'client.request.started'),
      event('b-response', 'b', 'client.response.received', {
        source: 'request',
        durationMs: 60,
      }),
      event('b-end', 'b', 'client.response.applied', {
        durationMs: 12,
        actionFailures: 0,
        skippedActions: 0,
      }),
    ]),
  );
  expect(
    view.rows.map((row) => ({
      client: row.request.clientId,
      outcome: row.outcome,
      timing: row.timing,
    })),
  ).toEqual([
    {
      client: 'a',
      outcome: 'applied',
      timing: { kind: 'reported', durationMs: 25 },
    },
    {
      client: 'b',
      outcome: 'applied',
      timing: { kind: 'reported', durationMs: 60 },
    },
  ]);
});

test('explicit producer uncertainty stays out of failure counts while legacy failures remain inspectable', () => {
  const data = evidence([
    event(
      'unknown',
      'a',
      'client.request.failed',
      { outcome: 'unknown', durationMs: 9 },
      'unknown',
    ),
    event('legacy', 'a', 'client.request.failed', { durationMs: 12 }, 'legacy'),
    event(
      'cancelled',
      'a',
      'client.request.failed',
      { outcome: 'cancelled' },
      'cancelled',
    ),
  ]);
  expect(requestOverview(data).rows.map((row) => row.outcome)).toEqual([
    'unknown',
    'failed',
    'cancelled',
  ]);
  expect(
    requestOverview(data, { outcome: 'failed' }).rows.map(
      (row) => row.request.requestId,
    ),
  ).toEqual(['legacy']);
  expect(
    requestOverview(data, { outcome: 'unknown' }).rows.map(
      (row) => row.request.requestId,
    ),
  ).toEqual(['unknown']);
});

test('observed Action failures do not prove application when the request producer cannot establish its outcome', () => {
  const view = requestOverview(
    evidence([
      event('action', 'a', 'client.action.completed', { outcome: 'failed' }),
      event('request', 'a', 'client.request.failed', { outcome: 'unknown' }),
    ]),
  );
  expect(view.rows[0].outcome).toBe('unknown');
});

test('missing source and Action counts cannot manufacture round-trip timing or a clean outcome', () => {
  const view = requestOverview(
    evidence([
      event('start', 'a', 'client.request.started'),
      event('response', 'a', 'client.response.received', {
        durationMs: 25,
        source: '[REDACTED]',
      }),
      event('end', 'a', 'client.response.applied', { durationMs: 5 }),
    ]),
  );
  expect(view.rows[0].timing).toEqual({
    kind: 'unreported',
    reason: 'source-unavailable',
  });
  expect(view.rows[0].outcome).toBe('unknown');
  expect(view.rows[0].request.transportMs).toBeUndefined();
});

test('filters and missing timings stay distinct from request-buffer loss and activity eviction', () => {
  const data = {
    ...evidence([event('activity', 'a', 'voice.media')]),
    dropped: 80,
    requestEvents: panelEvents([
      event(
        'a',
        'a',
        'client.response.applied',
        { durationMs: 4, actionFailures: 0, skippedActions: 0 },
        'first',
      ),
      event('b', 'b', 'client.request.failed', { durationMs: 9 }, 'second'),
      event('c', 'a', 'client.request.started', {}, 'third'),
    ]),
    droppedRequestEvents: 3,
    omittedRequestEvents: 2,
    unreadableRequestEvents: 0,
  };
  const view = requestOverview(data, {
    clientId: 'a',
    outcome: 'applied',
    measure: 'application',
  });
  expect({
    retained: view.retained,
    matched: view.matched,
    hidden: view.hidden,
    loss: view.loss,
  }).toEqual({
    retained: 3,
    matched: 1,
    hidden: 2,
    loss: { dropped: 3, omitted: 2, unreadable: 0 },
  });
  expect(view.rows.map((row) => row.request.requestId)).toEqual(['first']);
  expect(requestOverview(data, { timing: 'unreported' }).missingTimings).toBe(
    2,
  );
});

test('contradictory request identities have no definitive outcome or aggregate timing', () => {
  for (const events of [
    [
      event('applied', 'a', 'client.response.applied', {
        durationMs: 3,
        actionFailures: 0,
        skippedActions: 0,
      }),
      event('failed', 'a', 'client.response.failed', { durationMs: 7 }),
    ],
    [
      event('started', 'a', 'client.request.started'),
      {
        ...event('end', 'a', 'client.response.applied', {
          durationMs: 8,
          actionFailures: 0,
          skippedActions: 0,
        }),
        sessionId: 'other-session',
      },
    ],
  ]) {
    const view = requestOverview(evidence(events), { measure: 'application' });
    expect(view.rows[0].outcome).toBe('ambiguous');
    expect(view.rows[0].timing).toEqual({
      kind: 'unreported',
      reason: 'ambiguous',
    });
  }
});

test('partial captures with repeated receipts cannot assign the last duration to a reused identity', () => {
  for (const source of ['request', 'push']) {
    const data = evidence([
      event('receipt-one', 'a', 'client.response.received', {
        source: 'request',
        durationMs: 10,
      }),
      event('receipt-two', 'a', 'client.response.received', {
        source,
        durationMs: 99,
      }),
      event('end', 'a', 'client.response.applied', {
        durationMs: 3,
        actionFailures: 0,
        skippedActions: 0,
      }),
    ]);
    for (const measure of ['round-trip', 'application'] as const) {
      const row = requestOverview(data, { measure }).rows[0];
      expect(row.outcome).toBe('ambiguous');
      expect(row.timing).toEqual({ kind: 'unreported', reason: 'ambiguous' });
    }
  }
});

test('incompatible transport completions in partial imports cannot provide one outcome or aggregate timing', () => {
  for (const outcome of ['failed', 'cancelled', 'unknown']) {
    const data = recordingEvidence({
      events: [
        event('receipt', 'a', 'client.response.received', {
          source: 'request',
          durationMs: 10,
        }),
        event('failure', 'a', 'client.request.failed', {
          outcome,
          durationMs: 99,
        }),
      ],
    });
    for (const measure of ['round-trip', 'application'] as const) {
      const row = requestOverview(data, { measure }).rows[0];
      expect(row.outcome).toBe('ambiguous');
      expect(row.timing).toEqual({ kind: 'unreported', reason: 'ambiguous' });
    }
  }
  const valid = evidence([
    event('receipt', 'a', 'client.response.received', {
      source: 'request',
      durationMs: 10,
    }),
    event('application', 'a', 'client.response.failed', { durationMs: 3 }),
  ]);
  expect(requestOverview(valid).rows[0]).toMatchObject({
    outcome: 'failed',
    timing: { kind: 'reported', durationMs: 10 },
  });
  expect(
    requestOverview(valid, { measure: 'application' }).rows[0].timing,
  ).toEqual({ kind: 'reported', durationMs: 3 });
});

test('the time window uses one reported client clock and falls back to retained order when clocks are mixed or absent', () => {
  const rows = [
    event('engine', 'a', 'engine.request.started', {}, 'one', 9000),
    event('one', 'a', 'client.request.started', {}, 'one', 100),
    event('two', 'a', 'client.request.started', {}, 'two', 200),
  ];
  expect(requestOverview(evidence(rows)).window).toEqual({
    kind: 'client-time',
    clientId: 'a',
    from: 100,
    to: 200,
    missing: 0,
  });
  expect(
    requestOverview(
      evidence([...rows, event('other', 'b', 'client.request.started')]),
    ).window.kind,
  ).toBe('observed-order');
  expect(
    requestOverview(
      evidence([
        {
          ...event('missing', 'a', 'client.request.started'),
          at: '[REDACTED]',
        },
      ]),
    ).window,
  ).toMatchObject({ kind: 'observed-order', missing: 1 });
});

test('paging bounds the rendered sample without pretending remaining matches were lost', () => {
  const data = evidence(
    Array.from({ length: 125 }, (_, i) =>
      event(
        `end-${i}`,
        'a',
        'client.response.applied',
        { actionFailures: 0, skippedActions: 0 },
        `request-${i}`,
      ),
    ),
  );
  const view = requestOverview(data, { page: 1 });
  expect({
    retained: view.retained,
    matched: view.matched,
    hidden: view.hidden,
    rows: view.rows.length,
    page: view.page,
    pages: view.pages,
  }).toEqual({
    retained: 125,
    matched: 125,
    hidden: 0,
    rows: 50,
    page: 1,
    pages: 3,
  });
  expect(view.rows[0].request.requestId).toBe('request-50');
  expect(requestOverview(data, { page: 999 }).rows).toHaveLength(25);
  expect(view.loss.dropped).toBeUndefined();
});

test('withheld timings and unassigned identities remain explicit instead of becoming zero or disappearing', () => {
  const view = requestOverview(
    evidence([
      event(
        'redacted',
        'a',
        'client.response.received',
        { source: 'request', durationMs: '[REDACTED]' },
        'redacted',
      ),
      event(
        'truncated',
        'a',
        'client.response.received',
        { source: 'request', durationMs: '[TRUNCATED]' },
        'truncated',
      ),
      event('unassigned', 'a', 'client.response.applied', {}, '[REDACTED]'),
    ]),
  );
  expect(view.rows.map((row) => row.timing)).toEqual([
    { kind: 'unreported', reason: 'redacted' },
    { kind: 'unreported', reason: 'truncated' },
  ]);
  expect(view.unassigned).toBe(1);
  expect(view.retained).toBe(2);
});

test.each([
  undefined,
  '[REDACTED]',
  -1,
  0.5,
  '0',
])('invalid Action count %j does not become a clean request outcome', (count) => {
  const view = requestOverview(
    evidence([
      event('applied', 'a', 'client.response.applied', {
        durationMs: 0,
        actionFailures: count,
        skippedActions: 0,
      }),
    ]),
    { measure: 'application' },
  );
  expect(view.rows[0].outcome).toBe('unknown');
  expect(view.rows[0].timing).toEqual({ kind: 'reported', durationMs: 0 });
});

test('discarded pushes retain their provenance without a receipt or a fabricated missing request start', () => {
  const data = recordingEvidence({
    events: [
      event(
        'discarded-push',
        'a',
        'client.response.discarded',
        { source: 'push', reason: 'disposed' },
        'push',
      ),
      event(
        'request',
        'a',
        'client.response.discarded',
        { source: 'request' },
        'request',
      ),
      event(
        'withheld',
        'a',
        'client.response.discarded',
        { source: '[REDACTED]' },
        'withheld',
      ),
      event('custom', 'a', 'app.event', { source: 'push' }, 'custom'),
    ],
  });
  const view = requestOverview(data);
  expect(view.rows[0]).toMatchObject({
    outcome: 'discarded',
    request: { push: true, missingStart: false },
    timing: { kind: 'unreported', reason: 'push' },
  });
  for (const row of view.rows.slice(1)) {
    expect(row.request.push).toBe(false);
    expect(row.request.missingStart).toBe(true);
    expect(row.timing).toEqual({ kind: 'unreported', reason: 'missing' });
  }
  const ambiguous = requestOverview(
    recordingEvidence({
      events: [
        event('one', 'a', 'client.response.discarded', { source: 'push' }),
        event('two', 'a', 'client.response.failed', { durationMs: 9 }),
      ],
    }),
  ).rows[0];
  expect(ambiguous.outcome).toBe('ambiguous');
  expect(ambiguous.timing).toEqual({ kind: 'unreported', reason: 'ambiguous' });
});

test.each([
  { actionFailures: '[REDACTED]', skippedActions: 1 },
  { actionFailures: 2, skippedActions: '[TRUNCATED]' },
  { actionFailures: undefined, skippedActions: 1 },
  { actionFailures: 1, skippedActions: undefined },
])('a known terminal Action issue survives an unavailable companion counter: %j', (counters) => {
  const data = evidence([
    event('applied', 'a', 'client.response.applied', {
      ...counters,
      durationMs: 0,
    }),
  ]);
  const view = requestOverview(data, { measure: 'application' });
  expect(view.rows[0].outcome).toBe('applied-with-issues');
  expect(view.rows[0].timing).toEqual({ kind: 'reported', durationMs: 0 });
  expect(
    requestOverview(data, { outcome: 'applied-with-issues' }).matched,
  ).toBe(1);
  expect(requestOverview(data, { outcome: 'unknown' }).matched).toBe(0);
});

test.each([
  { actionFailures: '[REDACTED]', skippedActions: 0 },
  { actionFailures: 0, skippedActions: undefined },
  { actionFailures: '[REDACTED]', skippedActions: 0.5 },
  { actionFailures: Number.MAX_SAFE_INTEGER + 1, skippedActions: undefined },
  { actionFailures: undefined, skippedActions: Number.POSITIVE_INFINITY },
  { actionFailures: -1, skippedActions: undefined },
])('incomplete or invalid terminal counters cannot prove an Action issue: %j', (counters) => {
  const view = requestOverview(
    evidence([event('applied', 'a', 'client.response.applied', counters)]),
  );
  expect(view.rows[0].outcome).toBe('unknown');
});

test.each([
  {
    observations: [
      ['client.response.received', 'request'],
      ['client.response.discarded', 'push'],
    ] as const,
  },
  {
    observations: [
      ['client.request.started', undefined],
      ['client.response.received', 'request'],
      ['client.response.discarded', 'push'],
    ] as const,
  },
  {
    observations: [
      ['client.response.received', 'push'],
      ['client.response.discarded', 'request'],
    ] as const,
  },
  {
    observations: [
      ['client.request.started', undefined],
      ['client.response.discarded', 'push'],
    ] as const,
  },
])('conflicting request and push provenance cannot establish one request outcome: %j', ({
  observations,
}) => {
  const data = recordingEvidence({
    events: observations.map(([kind, source], i) =>
      event(`event-${i}`, 'a', kind, { source, durationMs: 10 }),
    ),
  });
  for (const measure of ['round-trip', 'application'] as const) {
    const row = requestOverview(data, { measure }).rows[0];
    expect(row.outcome).toBe('ambiguous');
    expect(row.timing).toEqual({ kind: 'unreported', reason: 'ambiguous' });
  }
});

test('withheld receipt provenance does not contradict an explicitly reported push outcome', () => {
  const row = requestOverview(
    evidence([
      event('receipt', 'a', 'client.response.received', {
        source: '[REDACTED]',
      }),
      event('terminal', 'a', 'client.response.discarded', { source: 'push' }),
    ]),
  ).rows[0];
  expect(row.outcome).toBe('discarded');
  expect(row.timing).toEqual({ kind: 'unreported', reason: 'push' });
});

test('terminal outcomes stay distinct and push timing never invents a request round-trip', () => {
  const view = requestOverview(
    evidence([
      event(
        'cancelled',
        'a',
        'client.request.failed',
        { outcome: 'cancelled' },
        'cancelled',
      ),
      event('failed', 'a', 'client.request.failed', {}, 'failed'),
      event('discarded', 'a', 'client.response.discarded', {}, 'discarded'),
      event('abandoned', 'a', 'client.response.abandoned', {}, 'abandoned'),
      event(
        'issue',
        'a',
        'client.response.applied',
        { actionFailures: 1, skippedActions: 0 },
        'issue',
      ),
      event('waiting', 'a', 'client.request.started', {}, 'waiting'),
      event(
        'push',
        'a',
        'client.response.received',
        { source: 'push', durationMs: 12 },
        'push',
      ),
      event(
        'push-end',
        'a',
        'client.response.applied',
        { durationMs: 0, actionFailures: 0, skippedActions: 0 },
        'push',
      ),
    ]),
  );
  expect(view.rows.map((row) => row.outcome)).toEqual([
    'cancelled',
    'failed',
    'discarded',
    'abandoned',
    'applied-with-issues',
    'awaiting',
    'applied',
  ]);
  expect(view.rows.at(-1)?.timing).toEqual({
    kind: 'unreported',
    reason: 'push',
  });
});

test('large imported recordings retain view omissions separately from unknown capture loss', () => {
  const data = recordingEvidence({
    events: Array.from({ length: 10005 }, (_, i) =>
      event(`event-${i}`, 'a', 'client.request.started', {}, `request-${i}`, i),
    ),
  });
  const view = requestOverview(data);
  expect(view.retained).toBe(10000);
  expect(view.rows).toHaveLength(50);
  expect(view.loss).toEqual({ dropped: undefined, omitted: 5, unreadable: 0 });
  expect(view.rows[0].firstIndex).toBe(5);
});
