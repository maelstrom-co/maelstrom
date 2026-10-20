import { describe, expect, test } from 'bun:test';

import { ActionName } from './action-name.js';
import { ChangeId, RunId } from './agent-ids.js';
import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentEventSchema,
  type AgentFinishReason,
  type AgentInput,
  AgentInputSchema,
} from './agent-wire.js';
import {
  AgentEventMessage,
  AgentInputMessage,
  decodeClientEnvelope,
  decodeServerEnvelope,
  encodeEnvelope,
} from './envelope.js';
import { InstanceId } from './instance.js';
import { MessageId } from './message.js';
import type { ChartRequest } from './request.js';
import type { MaelstromResponse } from './response.js';
import { ok } from './result.js';
import { SessionId } from './session.js';

const chart = (): ChartRequest => ({
  type: 'chart_request',
  context: {
    updateReasons: [{ type: 'user_intent', intent: 'show calendar' }],
    chartDimensions: { rows: 12, columns: 16 },
    layoutMode: 'grid',
  },
  instances: [],
  vessels: [],
  layout: { type: 'grid', positions: [] },
});

const response = (): MaelstromResponse => ({
  type: 'maelstrom_response',
  requestId: MessageId('req-1'),
  userMessage: 'done',
  rationale: 'because',
  executionPlan: [
    { instanceId: InstanceId('calendar-main'), action: ActionName('open') },
  ],
  layout: {
    type: 'grid',
    positions: [
      {
        instanceId: InstanceId('calendar-main'),
        position: { row: 0, column: 0 },
        size: { width: 4, height: 3 },
      },
    ],
  },
});

/**
 * One fixture per member. Keyed by the union discriminator, so adding a member
 * to either union without a fixture fails typecheck here.
 */
const inputFixtures: {
  [K in AgentInput['type']]: Extract<AgentInput, { type: K }>;
} = {
  utterance: {
    type: 'utterance',
    version: AGENT_WIRE_VERSION,
    inputId: MessageId('in-1'),
    text: 'show my calendar',
    chart: chart(),
    source: 'voice',
  },
  ui_applied: {
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: ChangeId('change-1'),
    chart: chart(),
    actionOutcomes: [
      { actionIndex: 0, ok: true },
      { actionIndex: 1, ok: false, error: 'Instance not mounted' },
    ],
  },
};

const eventFixtures: {
  [K in AgentEvent['type']]: Extract<AgentEvent, { type: K }>;
} = {
  placeholder: {
    type: 'placeholder',
    version: AGENT_WIRE_VERSION,
    inputId: MessageId('in-1'),
    text: 'One moment',
  },
  accepted: {
    type: 'accepted',
    version: AGENT_WIRE_VERSION,
    inputId: MessageId('in-1'),
    runId: RunId('run-1'),
    disposition: 'agent',
    ack: 'On it',
  },
  message: {
    type: 'message',
    version: AGENT_WIRE_VERSION,
    runId: RunId('run-1'),
    turnId: 'turn-1',
    delta: 'Here is ',
  },
  ui_change: {
    type: 'ui_change',
    version: AGENT_WIRE_VERSION,
    runId: RunId('run-1'),
    changeId: ChangeId('change-1'),
    response: response(),
  },
  finished: {
    type: 'finished',
    version: AGENT_WIRE_VERSION,
    runId: RunId('run-1'),
    ok: true,
    reason: 'completed',
    reply: 'Here is your calendar.',
    metrics: {
      turns: 2,
      toolCalls: 1,
      elapsedMs: 1250,
      inputTokens: 900,
      outputTokens: 120,
    },
  },
  error: {
    type: 'error',
    version: AGENT_WIRE_VERSION,
    inputId: MessageId('in-1'),
    error: 'unknown changeId',
  },
};

const discriminatorsOf = (schema: {
  options: readonly { shape: { type: { value: unknown } } }[];
}): string[] => schema.options.map((o) => String(o.shape.type.value)).sort();

const roundTrip = (
  schema: { parse: (v: unknown) => unknown },
  value: unknown,
) => schema.parse(JSON.parse(JSON.stringify(value)));

describe('AGENT_WIRE_VERSION', () => {
  test('is the integer 1', () => {
    expect(AGENT_WIRE_VERSION).toBe(1);
  });
});

describe('agent wire drift guard', () => {
  test('AgentInput schema members match the fixture keys exactly', () => {
    expect(discriminatorsOf(AgentInputSchema)).toEqual(
      Object.keys(inputFixtures).sort(),
    );
  });

  test('AgentEvent schema members match the fixture keys exactly', () => {
    expect(discriminatorsOf(AgentEventSchema)).toEqual(
      Object.keys(eventFixtures).sort(),
    );
  });
});

describe('AgentInput round-trip', () => {
  for (const [type, fixture] of Object.entries(inputFixtures)) {
    test(type, () => {
      expect(roundTrip(AgentInputSchema, fixture)).toEqual(fixture);
    });
  }

  test('utterance accepts both sources', () => {
    for (const source of ['text', 'voice'] as const) {
      const value = { ...inputFixtures.utterance, source };
      expect(roundTrip(AgentInputSchema, value)).toEqual(value);
    }
  });

  test('ui_applied carries the Chart state and per-Action outcomes in order', () => {
    const parsed = AgentInputSchema.parse(inputFixtures.ui_applied);
    if (parsed.type !== 'ui_applied') throw new Error('expected ui_applied');
    expect(parsed.chart).toEqual(chart());
    expect(parsed.actionOutcomes).toEqual([
      { actionIndex: 0, ok: true },
      { actionIndex: 1, ok: false, error: 'Instance not mounted' },
    ]);
  });

  test('rejects a negative or fractional actionIndex', () => {
    for (const actionIndex of [-1, 0.5]) {
      const value = {
        ...inputFixtures.ui_applied,
        actionOutcomes: [{ actionIndex, ok: true }],
      };
      expect(AgentInputSchema.safeParse(value).success).toBe(false);
    }
  });

  test('rejects an unknown source', () => {
    const value = { ...inputFixtures.utterance, source: 'telepathy' };
    expect(AgentInputSchema.safeParse(value).success).toBe(false);
  });
});

describe('AgentEvent round-trip', () => {
  for (const [type, fixture] of Object.entries(eventFixtures)) {
    test(type, () => {
      expect(roundTrip(AgentEventSchema, fixture)).toEqual(fixture);
    });
  }

  test('finished round-trips with each of the five reasons', () => {
    const reasons: AgentFinishReason[] = [
      'completed',
      'waiting',
      'cancelled',
      'budget',
      'error',
    ];
    for (const reason of reasons) {
      const failed = reason === 'error' || reason === 'budget';
      const value = {
        ...eventFixtures.finished,
        ok: reason === 'completed' || reason === 'waiting',
        reason,
        ...(failed ? { error: 'model failed', code: 'model_error' } : {}),
      };
      expect(roundTrip(AgentEventSchema, value)).toEqual(value);
    }
  });

  test('finished rejects an ok flag that contradicts the reason', () => {
    for (const value of [
      { ...eventFixtures.finished, ok: true, reason: 'error' },
      { ...eventFixtures.finished, ok: false, reason: 'completed' },
    ]) {
      const result = AgentEventSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(['ok']);
    }
  });

  test('accepted round-trips with each disposition', () => {
    for (const disposition of [
      'ui_only',
      'agent',
      'amend',
      'independent',
      'answer',
      'supersede',
      'noise',
    ] as const) {
      const runId =
        disposition === 'ui_only' || disposition === 'noise'
          ? null
          : RunId('run-1');
      const value = { ...eventFixtures.accepted, disposition, runId };
      expect(roundTrip(AgentEventSchema, value)).toEqual(value);
    }
  });

  test('accepted rejects a null runId for a disposition that starts a run', () => {
    const result = AgentEventSchema.safeParse({
      ...eventFixtures.accepted,
      disposition: 'agent',
      runId: null,
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['runId']);
  });

  test('accepted rejects a runId for a disposition that starts no run', () => {
    const result = AgentEventSchema.safeParse({
      ...eventFixtures.accepted,
      disposition: 'noise',
      runId: RunId('run-1'),
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['runId']);
  });

  test('accepted rejects a missing runId', () => {
    const { runId: _omit, ...withoutRunId } = eventFixtures.accepted;
    const result = AgentEventSchema.safeParse(withoutRunId);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['runId']);
  });

  test('rejects empty or missing member ids', () => {
    const { runId: _omit, ...uiChangeWithoutRunId } = eventFixtures.ui_change;
    const rows: [
      typeof AgentEventSchema | typeof AgentInputSchema,
      unknown,
      string[],
    ][] = [
      [AgentEventSchema, { ...eventFixtures.message, turnId: '' }, ['turnId']],
      [AgentEventSchema, { ...eventFixtures.finished, runId: '' }, ['runId']],
      [
        AgentEventSchema,
        { ...eventFixtures.ui_change, changeId: '  ' },
        ['changeId'],
      ],
      [AgentEventSchema, uiChangeWithoutRunId, ['runId']],
      [
        AgentInputSchema,
        { ...inputFixtures.ui_applied, changeId: '  ' },
        ['changeId'],
      ],
    ];
    for (const [schema, value, path] of rows) {
      const result = schema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(path);
    }
  });

  test('ui_change accepts a null runId for changes outside an Agent Run', () => {
    const value = { ...eventFixtures.ui_change, runId: null };
    expect(roundTrip(AgentEventSchema, value)).toEqual(value);
  });

  test('error round-trips without an inputId and with a code', () => {
    const value: AgentEvent = {
      type: 'error',
      version: AGENT_WIRE_VERSION,
      error: 'token refresh refused',
      code: 'token_refused',
    };
    expect(roundTrip(AgentEventSchema, value)).toEqual(value);
  });

  test('rejects negative or fractional metrics', () => {
    for (const turns of [-1, 1.5]) {
      const value = {
        ...eventFixtures.finished,
        metrics: { ...eventFixtures.finished.metrics, turns },
      };
      expect(AgentEventSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('agent wire tolerates unknown optional fields', () => {
  test('every input member strips an unknown field', () => {
    for (const fixture of Object.values(inputFixtures)) {
      const result = AgentInputSchema.safeParse({
        ...fixture,
        futureField: 'x',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(fixture);
    }
  });

  test('every event member strips an unknown field', () => {
    for (const fixture of Object.values(eventFixtures)) {
      const result = AgentEventSchema.safeParse({
        ...fixture,
        futureField: 'x',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(fixture);
    }
  });
});

describe('agent wire decode failures', () => {
  test('unknown input type fails at the discriminator', () => {
    const result = AgentInputSchema.safeParse({
      type: 'telepathy',
      version: AGENT_WIRE_VERSION,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  test('unknown event type fails at the discriminator', () => {
    const result = AgentEventSchema.safeParse({
      type: 'telepathy',
      version: AGENT_WIRE_VERSION,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  test('a wrong or missing version fails on every input member', () => {
    for (const fixture of Object.values(inputFixtures)) {
      for (const version of [2, '1', undefined]) {
        const result = AgentInputSchema.safeParse({ ...fixture, version });
        expect(result.success).toBe(false);
        if (!result.success)
          expect(result.error.issues[0]?.path).toEqual(['version']);
      }
    }
  });

  test('a wrong or missing version fails on every event member', () => {
    for (const fixture of Object.values(eventFixtures)) {
      for (const version of [2, '1', undefined]) {
        const result = AgentEventSchema.safeParse({ ...fixture, version });
        expect(result.success).toBe(false);
        if (!result.success)
          expect(result.error.issues[0]?.path).toEqual(['version']);
      }
    }
  });
});

describe('agent wire through the Envelope codecs', () => {
  const sessionId = SessionId('s-1');

  for (const [type, input] of Object.entries(inputFixtures)) {
    test(`client.agent.input carrying ${type}`, () => {
      const frame = AgentInputMessage({
        sessionId,
        id: MessageId(`frame-${type}`),
        input,
      });
      expect(decodeClientEnvelope(encodeEnvelope(frame))).toEqual(ok(frame));
    });
  }

  for (const [type, event] of Object.entries(eventFixtures)) {
    test(`engine.agent.event carrying ${type}`, () => {
      const frame = AgentEventMessage({
        sessionId,
        id: MessageId(`frame-${type}`),
        event,
      });
      expect(decodeServerEnvelope(encodeEnvelope(frame))).toEqual(ok(frame));
    });
  }

  test('an unknown inner input type is an invalid_envelope naming the discriminator', () => {
    const decoded = decodeClientEnvelope({
      type: 'client.agent.input',
      id: 'frame-1',
      sessionId: 's-1',
      input: { type: 'telepathy', version: AGENT_WIRE_VERSION },
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('input.type');
    }
  });

  test('an unknown inner event type is an invalid_envelope naming the discriminator', () => {
    const decoded = decodeServerEnvelope({
      type: 'engine.agent.event',
      id: 'frame-1',
      sessionId: 's-1',
      event: { type: 'telepathy', version: AGENT_WIRE_VERSION },
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('event.type');
    }
  });

  test('a wrong inner input version is an invalid_envelope naming the field', () => {
    const decoded = decodeClientEnvelope({
      type: 'client.agent.input',
      id: 'frame-1',
      sessionId: 's-1',
      input: { ...inputFixtures.utterance, version: 2 },
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('input.version');
    }
  });

  test('a wrong inner event version is an invalid_envelope naming the field', () => {
    const decoded = decodeServerEnvelope({
      type: 'engine.agent.event',
      id: 'frame-1',
      sessionId: 's-1',
      event: { ...eventFixtures.finished, version: 2 },
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('event.version');
    }
  });
});
