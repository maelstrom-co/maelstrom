import { expect, test } from 'bun:test';
import {
  eventIssue,
  groupRequests,
  panelEvents,
  plannerEvidence,
} from './panel-model.js';
import { requestOverview } from './request-overview.js';

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

test('planner observations preserve a recovered validation failure without claiming which attempt owns it', () => {
  const request = groupRequests(
    panelEvents([
      event('client.request.started'),
      event('engine.planner.attempt', 'app-a', 'request', {
        'maelstrom.attempt': 0,
      }),
      event('engine.candidate.validated', 'app-a', 'request', {
        outcome: 'failed',
      }),
      event('engine.planner.attempt', 'app-a', 'request', {
        'maelstrom.attempt': 1,
      }),
      event('engine.candidate.validated', 'app-a', 'request', {
        outcome: 'succeeded',
      }),
      event('client.response.applied'),
    ]),
  )[0];
  expect(
    plannerEvidence(request).map(({ eventKey: _eventKey, ...fact }) => fact),
  ).toEqual([
    { kind: 'attempt', attempt: { kind: 'reported', value: 0 } },
    {
      kind: 'validation',
      outcome: { kind: 'reported', value: 'failed' },
    },
    { kind: 'attempt', attempt: { kind: 'reported', value: 1 } },
    {
      kind: 'validation',
      outcome: { kind: 'reported', value: 'succeeded' },
    },
  ]);
  expect(request.status).toBe('applied');
});

test('model reports keep reported zero tokens distinct from missing usage and never sum nested work', () => {
  const request = groupRequests(
    panelEvents([
      event('engine.llm.call', 'app-a', 'request', {
        'gen_ai.request.model': 'model-a',
        'gen_ai.usage.input_tokens': 0,
        'gen_ai.usage.output_tokens': 3,
        'maelstrom.outcome': 'ok',
        'maelstrom.latency_ms': 15,
      }),
      event('engine.jev.call', 'app-a', 'request', {
        'gen_ai.request.model': 'model-b',
        'maelstrom.stage': 'layout',
        'maelstrom.outcome': 'provider_timeout',
        'maelstrom.latency_ms': 7,
      }),
    ]),
  )[0];
  expect(
    plannerEvidence(request).map(({ eventKey: _eventKey, ...fact }) => fact),
  ).toEqual([
    {
      kind: 'call',
      source: 'llm',
      model: { kind: 'reported', value: 'model-a' },
      stage: { kind: 'unreported', reason: 'not-reported' },
      outcome: { kind: 'reported', value: 'ok' },
      durationMs: { kind: 'reported', value: 15 },
      inputTokens: { kind: 'reported', value: 0 },
      outputTokens: { kind: 'reported', value: 3 },
    },
    {
      kind: 'call',
      source: 'jev',
      model: { kind: 'reported', value: 'model-b' },
      stage: { kind: 'reported', value: 'layout' },
      outcome: { kind: 'reported', value: 'provider_timeout' },
      durationMs: { kind: 'reported', value: 7 },
      inputTokens: { kind: 'unreported', reason: 'not-reported' },
      outputTokens: { kind: 'unreported', reason: 'not-reported' },
    },
  ]);
});

test('the largest safe reported attempt remains inspectable without rounding or becoming unavailable', () => {
  const request = groupRequests(
    panelEvents([
      event('engine.planner.attempt', 'app-a', 'request', {
        'maelstrom.attempt': Number.MAX_SAFE_INTEGER,
      }),
    ]),
  )[0];
  expect(plannerEvidence(request)).toMatchObject([
    {
      kind: 'attempt',
      attempt: { kind: 'reported', value: 9007199254740991 },
    },
  ]);
});

test('planner evidence rejects unsafe attempt ordinals and does not combine reused request lifetimes', () => {
  const requests = groupRequests(
    panelEvents([
      event('client.request.started'),
      event('engine.planner.attempt', 'app-a', 'request', {
        'maelstrom.attempt': 0,
      }),
      event('client.request.started'),
      event('engine.planner.attempt', 'app-a', 'request', {
        'maelstrom.attempt': 1,
      }),
      event('engine.planner.attempt', 'app-b', 'request', {
        'maelstrom.attempt': Number.MAX_SAFE_INTEGER + 1,
      }),
    ]),
  );
  expect(
    plannerEvidence(requests.find((request) => request.clientId === 'app-a')!),
  ).toEqual([]);
  expect(
    plannerEvidence(requests.find((request) => request.clientId === 'app-b')!),
  ).toMatchObject([
    {
      kind: 'attempt',
      attempt: { kind: 'unreported', reason: 'unreadable' },
    },
  ]);
});

test('planning observations preserve reported cancellation and independent durations without inferring a time span', () => {
  const request = groupRequests(
    panelEvents([
      event('engine.planner.started'),
      event('engine.planner.completed', 'app-a', 'request', {
        outcome: 'succeeded',
        durationMs: 18,
      }),
      event('engine.planner.failed', 'app-a', 'request', {
        outcome: 'cancelled',
        durationMs: 0,
      }),
    ]),
  )[0];
  expect(
    plannerEvidence(request).map(({ eventKey: _eventKey, ...fact }) => fact),
  ).toEqual([
    {
      kind: 'planning',
      phase: 'started',
      outcome: { kind: 'reported', value: 'started' },
      durationMs: { kind: 'unreported', reason: 'not-reported' },
    },
    {
      kind: 'planning',
      phase: 'completed',
      outcome: { kind: 'reported', value: 'succeeded' },
      durationMs: { kind: 'reported', value: 18 },
    },
    {
      kind: 'planning',
      phase: 'failed',
      outcome: { kind: 'reported', value: 'cancelled' },
      durationMs: { kind: 'reported', value: 0 },
    },
  ]);
});

test.each([
  ['[REDACTED]', 'redacted'],
  ['[TRUNCATED]', 'truncated'],
  ['[MAX_DEPTH]', 'unreadable'],
  [-1, 'unreadable'],
  [0.5, 'unreadable'],
  [Number.MAX_SAFE_INTEGER + 1, 'unreadable'],
  ['12', 'unreadable'],
  [null, 'not-reported'],
] as const)('planner token evidence keeps unavailable %s explicit instead of converting it to zero', (tokens, reason) => {
  const request = groupRequests(
    panelEvents([
      event('engine.llm.call', 'app-a', 'request', {
        'gen_ai.usage.input_tokens': tokens,
        'gen_ai.request.model': '[REDACTED]',
        'maelstrom.outcome': 'unsupported',
      }),
      event('engine.custom.call', 'app-a', 'request', {
        'gen_ai.usage.input_tokens': 100,
      }),
    ]),
  )[0];
  expect(plannerEvidence(request)).toMatchObject([
    {
      kind: 'call',
      model: { kind: 'unreported', reason: 'redacted' },
      outcome: { kind: 'unreported', reason: 'unreadable' },
      inputTokens: { kind: 'unreported', reason },
    },
  ]);
  expect(plannerEvidence(request)).toHaveLength(1);
});

test('Agent Run Planner events never join a request or count as its failure while staying visible as event issues', () => {
  const runEvent = (kind: string, metadata: Record<string, unknown> = {}) => {
    const { requestId: _requestId, ...owned } = event(
      kind,
      'app-a',
      'request',
      {
        inputId: 'input-1',
        ...metadata,
      },
    );
    return { ...owned, runId: 'run-1' };
  };
  const events = panelEvents([
    event('client.request.started'),
    event('engine.planner.started'),
    runEvent('engine.planner.started'),
    runEvent('engine.planner.failed', { outcome: 'failed', durationMs: 4 }),
    event('engine.planner.completed', 'app-a', 'request', {
      outcome: 'succeeded',
      durationMs: 7,
    }),
    event('client.response.applied', 'app-a', 'request', {
      actionFailures: 0,
      skippedActions: 0,
    }),
  ]);
  const requests = groupRequests(events);
  expect(requests).toHaveLength(1);
  expect(requests[0].events.some((entry) => entry.raw.runId)).toBe(false);
  expect(requests[0].issues).toEqual([]);
  expect(requests[0].status).toBe('applied');
  expect(
    plannerEvidence(requests[0]).map((observation) =>
      observation.kind === 'planning' ? observation.phase : observation.kind,
    ),
  ).toEqual(['started', 'completed']);
  expect(
    requestOverview({ events, apps: [], omitted: 0, metadata: {} }).unassigned,
  ).toBe(0);
  const runFailure = events.find(
    (entry) => entry.raw.runId && entry.kind === 'engine.planner.failed',
  );
  if (!runFailure) throw new Error('Missing run failure');
  expect(eventIssue(runFailure)?.outcome).toBe('failed');
});
