import { expect, test } from 'bun:test';

import {
  groupRequests,
  type PanelEvidence,
  panelEvents,
  requestCounterparts,
} from './panel-model.js';
import {
  isComparisonSourceIncomplete,
  isIncompleteSourceEvent,
} from './request-counterparts.js';

function trace(
  id: string,
  observations: Array<{ kind: string; metadata: Record<string, unknown> }>,
) {
  return groupRequests(
    panelEvents(
      [
        { kind: 'client.request.started' },
        ...observations,
        { kind: 'client.response.applied' },
      ].map((event, index) => ({
        ...event,
        id: `${id}-${index}`,
        requestId: id,
        sessionId: 'session',
        metadata: {
          clientId: 'app',
          ...('metadata' in event ? event.metadata : {}),
        },
      })),
    ),
  )[0]!;
}

test('comparison exposes one-sided stages and Action targets without pairing repeated invocations', () => {
  const a = trace('a', [
    { kind: 'engine.stage.completed', metadata: { stage: 'plan' } },
    {
      kind: 'client.action.completed',
      metadata: {
        action: 'open',
        instanceId: 'calendar',
        toolCallId: 'reused',
      },
    },
    {
      kind: 'client.action.completed',
      metadata: {
        action: 'open',
        instanceId: 'calendar',
        toolCallId: 'reused',
      },
    },
  ]);
  const b = trace('b', [
    { kind: 'engine.stage.completed', metadata: { stage: 'validate' } },
    {
      kind: 'client.action.completed',
      metadata: { action: 'open', instanceId: 'map', toolCallId: 'reused' },
    },
  ]);
  const counterparts = requestCounterparts(a, b);
  expect(
    a.events.slice(1, 4).map((event) => counterparts.get(event.key)),
  ).toEqual(['unmatched', 'unmatched', 'unmatched']);
  expect(counterparts.size).toBe(5);
  expect(requestCounterparts(a, a).get(a.events[2]!.key)).toBe('unknown');
});

test('missing or redacted operation fields and source loss cannot establish an unmatched invocation', () => {
  const a = trace('a', [
    {
      kind: 'client.action.completed',
      metadata: { action: 'open', instanceId: 'calendar' },
    },
  ]);
  for (const metadata of [
    { action: 'open' },
    { action: 'open', instanceId: '[REDACTED]' },
  ]) {
    const b = trace('b', [{ kind: 'client.action.completed', metadata }]);
    expect(requestCounterparts(a, b).get(a.events[1]!.key)).toBe('unknown');
  }
  const b = trace('b', []);
  expect(requestCounterparts(a, b, true).get(a.events[1]!.key)).toBe(
    'incomplete',
  );
  expect(requestCounterparts(a, undefined).get(a.events[1]!.key)).toBe(
    'unavailable',
  );
  const partial = groupRequests(
    panelEvents([
      {
        id: 'partial',
        sessionId: 'session',
        requestId: 'b',
        kind: 'client.response.applied',
        metadata: { clientId: 'app' },
      },
    ]),
  )[0]!;
  expect(requestCounterparts(a, partial).get(a.events[1]!.key)).toBe(
    'incomplete',
  );
});

test('run-owned diagnostics do not make request comparison evidence incomplete', () => {
  const comparedKinds = new Set(['engine.stage.completed']);
  const [requestOwned, runOwned] = panelEvents([
    {
      id: 'request-owned',
      sessionId: 'session',
      requestId: 'a',
      kind: 'engine.stage.completed',
      metadata: { clientId: 'app' },
    },
    {
      id: 'run-owned',
      sessionId: 'session',
      runId: 'run-1',
      kind: 'engine.stage.completed',
      metadata: { clientId: 'app' },
    },
  ]);
  expect(isIncompleteSourceEvent(requestOwned!, comparedKinds)).toBe(false);
  expect(isIncompleteSourceEvent(runOwned!, comparedKinds)).toBe(false);
});

test('an engine event with neither requestId nor runId still makes request comparison evidence incomplete', () => {
  const [unassigned] = panelEvents([
    {
      id: 'unassigned',
      sessionId: 'session',
      kind: 'engine.stage.completed',
      metadata: { clientId: 'app' },
    },
  ]);
  expect(isIncompleteSourceEvent(unassigned!, new Set())).toBe(true);
});

test('run ownership requires a reported runId and no reported requestId', () => {
  const comparedKinds = new Set(['engine.stage.completed']);
  const cases: Array<{
    name: string;
    fields: Record<string, unknown>;
    clientId?: string;
    incomplete: boolean;
  }> = [
    {
      name: 'requestId and runId without clientId',
      fields: { requestId: 'a', runId: 'run-1' },
      incomplete: true,
    },
    {
      name: 'redacted requestId with runId',
      fields: { requestId: '[REDACTED]', runId: 'run-1' },
      clientId: 'app',
      incomplete: true,
    },
    {
      name: 'null runId',
      fields: { runId: null },
      clientId: 'app',
      incomplete: true,
    },
    {
      name: 'empty runId',
      fields: { runId: '' },
      clientId: 'app',
      incomplete: true,
    },
    {
      name: 'redacted runId without requestId',
      fields: { runId: '[REDACTED]' },
      clientId: 'app',
      incomplete: false,
    },
  ];
  for (const { name, fields, clientId, incomplete } of cases) {
    const [event] = panelEvents([
      {
        id: name,
        sessionId: 'session',
        kind: 'engine.stage.completed',
        ...fields,
        metadata: clientId ? { clientId } : {},
      },
    ]);
    expect({
      name,
      incomplete: isIncompleteSourceEvent(event!, comparedKinds),
    }).toEqual({ name, incomplete });
  }
});

test('comparison source stays complete with run-owned diagnostics and turns incomplete with an unassigned engine event', () => {
  const a = trace('a', [
    { kind: 'engine.stage.completed', metadata: { stage: 'plan' } },
  ]);
  const b = trace('b', [
    { kind: 'engine.stage.completed', metadata: { stage: 'plan' } },
  ]);
  const [runOwned, unassigned] = panelEvents([
    {
      id: 'run-owned',
      sessionId: 'session',
      runId: 'run-1',
      kind: 'engine.stage.completed',
      metadata: { clientId: 'app' },
    },
    {
      id: 'unassigned',
      sessionId: 'session',
      kind: 'engine.stage.completed',
      metadata: { clientId: 'app' },
    },
  ]);
  const evidence = (
    events: PanelEvidence['events'],
    requestEvents?: PanelEvidence['requestEvents'],
  ): PanelEvidence => ({
    events,
    requestEvents,
    apps: [],
    omitted: 0,
    metadata: {},
  });
  const mixed = [...a.events, runOwned!, ...b.events];
  expect(isComparisonSourceIncomplete(evidence(mixed), [a, b])).toBe(false);
  expect(
    isComparisonSourceIncomplete(evidence(mixed, [...a.events, ...b.events]), [
      a,
      b,
    ]),
  ).toBe(false);
  expect(
    isComparisonSourceIncomplete(evidence([...mixed, unassigned!]), [a, b]),
  ).toBe(true);
  expect(
    isComparisonSourceIncomplete(evidence(mixed, [unassigned!]), [a, b]),
  ).toBe(true);
});
