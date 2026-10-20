import { describe, expect, test } from 'bun:test';

import { ActionName } from './action-name.js';
import { RunId } from './agent-ids.js';
import { AGENT_WIRE_VERSION } from './agent-wire.js';
import {
  AssistantInjectionMessage,
  ChartRequestMessage,
} from './engine-message.js';
import {
  AcknowledgedAssistantMessage,
  AgentEventMessage,
  AgentInputMessage,
  AssistantMessageResultMessage,
  ClientEnvelopeSchema,
  decodeClientEnvelope,
  decodeServerEnvelope,
  EngineErrorMessage,
  encodeEnvelope,
  HistoryGetMessage,
  HistoryResponseMessage,
  MaelstromResponseMessage,
  ServerEnvelopeSchema,
} from './envelope.js';
import { InstanceId } from './instance.js';
import { MessageId } from './message.js';
import type { ChartRequest } from './request.js';
import type { MaelstromResponse } from './response.js';
import { isErr, ok } from './result.js';
import { SessionId } from './session.js';
import type { SessionHistoryEntry } from './session-history-entry.js';

// A ChartRequest that passes ChartRequestSchema end-to-end (grid layout matching
// layoutMode, no instances/vessels to cross-reference).
const validChartRequest = (): ChartRequest => ({
  type: 'chart_request',
  context: {
    updateReasons: [{ type: 'user_intent', intent: 'hi' }],
    chartDimensions: { rows: 12, columns: 16 },
    layoutMode: 'grid',
  },
  instances: [],
  vessels: [],
  layout: { type: 'grid', positions: [] },
});

const validMaelstromResponse = (): MaelstromResponse => ({
  type: 'maelstrom_response',
  requestId: MessageId('req-1'),
  userMessage: 'done',
  rationale: 'because',
  executionPlan: [
    {
      instanceId: InstanceId('calendar-main'),
      action: ActionName('open'),
      params: { day: 3 },
    },
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

const historyEntries = (): readonly SessionHistoryEntry[] => [
  {
    kind: 'turn',
    id: MessageId('m-1'),
    sessionId: SessionId('s-1'),
    timestamp: 1_700_000_000_000,
    userIntent: 'show calendar',
    assistantMessage: 'here it is',
  },
  {
    kind: 'injection',
    id: MessageId('m-2'),
    sessionId: SessionId('s-1'),
    timestamp: 1_700_000_000_001,
    content: 'note',
  },
];

// ---------------------------------------------------------------------------
// Client envelope round-trips
// ---------------------------------------------------------------------------

describe('ClientEnvelope round-trip', () => {
  test('chart_request', () => {
    const msg = ChartRequestMessage({
      sessionId: SessionId('s-1'),
      request: validChartRequest(),
      id: MessageId('m-cr'),
      timestamp: 1_700_000_000_000,
    });
    const decoded = decodeClientEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'chart_request') {
      expect(decoded.value).toEqual(msg);
    } else {
      throw new Error('expected chart_request');
    }
  });

  test('assistant_message', () => {
    const msg = AssistantInjectionMessage({
      sessionId: SessionId('s-1'),
      content: 'hello world',
      id: MessageId('m-am'),
      timestamp: 1_700_000_000_000,
    });
    const decoded = decodeClientEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'assistant_message') {
      expect(decoded.value).toEqual(msg);
    } else {
      throw new Error('expected assistant_message');
    }
  });

  test('client.assistant_message.acknowledged', () => {
    const msg = AcknowledgedAssistantMessage({
      sessionId: SessionId('s-1'),
      content: 'hello world',
      id: MessageId('m-am-ack'),
      timestamp: 1_700_000_000_000,
    });
    const decoded = decodeClientEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (
      decoded.ok &&
      decoded.value.type === 'client.assistant_message.acknowledged'
    ) {
      expect(decoded.value).toEqual(msg);
    } else {
      throw new Error('expected client.assistant_message.acknowledged');
    }
  });

  test('acknowledged assistant constructor rejects an empty payload', () => {
    expect(() =>
      AcknowledgedAssistantMessage({
        sessionId: SessionId('s-1'),
        content: '',
      }),
    ).toThrow();
  });

  test('client.history.get', () => {
    const msg = HistoryGetMessage({
      sessionId: SessionId('s-1'),
      id: MessageId('m-hg'),
    });
    const decoded = decodeClientEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'client.history.get') {
      expect(decoded.value).toEqual(msg);
      expect(decoded.value.sessionId).toBe(SessionId('s-1'));
    } else {
      throw new Error('expected client.history.get');
    }
  });
});

// ---------------------------------------------------------------------------
// Server envelope round-trips
// ---------------------------------------------------------------------------

describe('ServerEnvelope round-trip', () => {
  test.each([
    'inserted',
    'deduped',
  ] as const)('engine.assistant_message.result (%s)', (outcome) => {
    const msg = AssistantMessageResultMessage({
      requestId: MessageId('req-X'),
      sessionId: SessionId('s-1'),
      outcome,
    });
    const decoded = decodeServerEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('expected a decodable server envelope');
    expect(decoded.value.type).toBe('engine.assistant_message.result');
    if (decoded.value.type !== 'engine.assistant_message.result') {
      throw new Error('expected engine.assistant_message.result');
    }
    expect(decoded.value.requestId).toBe(MessageId('req-X'));
    expect(decoded.value.sessionId).toBe(SessionId('s-1'));
    expect(decoded.value.outcome).toBe(outcome);
  });

  test('engine.maelstrom.response', () => {
    const msg = MaelstromResponseMessage({
      requestId: MessageId('req-1'),
      sessionId: SessionId('s-1'),
      response: validMaelstromResponse(),
    });
    const decoded = decodeServerEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'engine.maelstrom.response') {
      expect(decoded.value).toEqual(msg);
      expect(decoded.value.response.layout.type).toBe('grid');
    } else {
      throw new Error('expected engine.maelstrom.response');
    }
  });

  test('engine.history.response', () => {
    const msg = HistoryResponseMessage({
      requestId: MessageId('req-1'),
      entries: historyEntries(),
    });
    const decoded = decodeServerEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'engine.history.response') {
      expect(decoded.value).toEqual(msg);
      expect(decoded.value.entries).toHaveLength(2);
    } else {
      throw new Error('expected engine.history.response');
    }
  });

  test('engine.error', () => {
    const msg = EngineErrorMessage({
      error: 'boom',
      requestId: MessageId('req-1'),
      sessionId: SessionId('s-1'),
      code: 'RATE_LIMIT',
    });
    const decoded = decodeServerEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'engine.error') {
      expect(decoded.value).toEqual(msg);
    } else {
      throw new Error('expected engine.error');
    }
  });
});

// ---------------------------------------------------------------------------
// Input forms
// ---------------------------------------------------------------------------

describe('decode input forms', () => {
  const msg = HistoryGetMessage({
    sessionId: SessionId('s-1'),
    id: MessageId('m-hg'),
  });

  test('accepts a JSON string', () => {
    const decoded = decodeClientEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
  });

  test('accepts a pre-parsed object', () => {
    const decoded = decodeClientEnvelope({
      type: 'client.history.get',
      id: 'm-hg',
      sessionId: 's-1',
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.type).toBe('client.history.get');
  });

  test('accepts a Uint8Array', () => {
    const bytes = new TextEncoder().encode(encodeEnvelope(msg));
    const decoded = decodeClientEnvelope(bytes);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value).toEqual(msg);
  });
});

// ---------------------------------------------------------------------------
// Failure cases
// ---------------------------------------------------------------------------

describe('decode failures', () => {
  test('malformed JSON string → invalid_json naming the parse failure', () => {
    const decoded = decodeClientEnvelope('{ not json');
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_json');
      expect(decoded.error.message).toMatch(/JSON\.parse/);
    }
  });

  test('unknown type discriminator (client) → invalid_envelope naming the type', () => {
    const decoded = decodeClientEnvelope({
      type: 'audio_intent',
      id: 'm-1',
      sessionId: 's-1',
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('audio_intent');
    }
  });

  test('unknown type discriminator (server) → invalid_envelope naming the type', () => {
    const decoded = decodeServerEnvelope({
      type: 'engine.unknown',
      requestId: 'req-1',
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('engine.unknown');
    }
  });

  test('missing required requestId on engine.maelstrom.response → invalid_envelope naming the field', () => {
    const decoded = decodeServerEnvelope({
      type: 'engine.maelstrom.response',
      response: validMaelstromResponse(),
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('requestId');
    }
  });

  test('non-finite timestamp on chart_request → invalid_envelope naming the field', () => {
    // Passed as a pre-parsed object: JSON.stringify would coerce NaN to null,
    // so the envelope-level refinement can only be exercised off-wire.
    const decoded = decodeClientEnvelope({
      type: 'chart_request',
      sessionId: 's-1',
      id: 'm-1',
      timestamp: Number.NaN,
      request: validChartRequest(),
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('timestamp');
    }
  });

  test.each([
    ['empty content', { content: '' }],
    ['empty id', { id: '' }],
    ['empty sessionId', { sessionId: '' }],
    ['non-finite timestamp', { timestamp: Number.POSITIVE_INFINITY }],
  ])('malformed acknowledged assistant message (%s) → invalid_envelope', (_case, override) => {
    const decoded = decodeClientEnvelope({
      type: 'client.assistant_message.acknowledged',
      sessionId: 's-1',
      id: 'm-am-ack',
      timestamp: 1_700_000_000_000,
      content: 'hello world',
      ...override,
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
    }
  });

  test('empty-string requestId → invalid_envelope', () => {
    const decoded = decodeServerEnvelope({
      type: 'engine.error',
      requestId: '',
      error: 'boom',
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('requestId');
    }
  });
});

// ---------------------------------------------------------------------------
// engine.error optional fields
// ---------------------------------------------------------------------------

describe('engine.error optional fields', () => {
  test('code present survives round-trip', () => {
    const msg = EngineErrorMessage({
      error: 'boom',
      requestId: MessageId('req-1'),
      code: 'RATE_LIMIT',
    });
    const decoded = decodeServerEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'engine.error') {
      expect(decoded.value.code).toBe('RATE_LIMIT');
    } else {
      throw new Error('expected engine.error');
    }
  });

  test('code absent stays absent', () => {
    const msg = EngineErrorMessage({
      error: 'boom',
      requestId: MessageId('req-1'),
    });
    expect('code' in msg).toBe(false);
    const decoded = decodeServerEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'engine.error') {
      expect(decoded.value.code).toBeUndefined();
      expect('code' in decoded.value).toBe(false);
    } else {
      throw new Error('expected engine.error');
    }
  });

  test('without requestId is valid and round-trips', () => {
    const msg = EngineErrorMessage({ error: 'stream fault' });
    expect('requestId' in msg).toBe(false);
    const decoded = decodeServerEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'engine.error') {
      expect(decoded.value).toEqual(msg);
      expect(decoded.value.requestId).toBeUndefined();
    } else {
      throw new Error('expected engine.error');
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-check: EngineMessage constructors produce valid ClientEnvelopes
// ---------------------------------------------------------------------------

describe('EngineMessage ↔ ClientEnvelope', () => {
  test('a ChartRequestMessage from its smart constructor decodes as a ClientEnvelope', () => {
    const msg = ChartRequestMessage({
      sessionId: SessionId('s-1'),
      request: validChartRequest(),
    });
    const decoded = decodeClientEnvelope(encodeEnvelope(msg));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.type).toBe('chart_request');
  });

  test('the direction schemas are the same discriminated-union contract', () => {
    // Guards against a member silently dropping out of a union: the schema a
    // host would safeParse against must accept exactly what the codec accepts.
    expect(ClientEnvelopeSchema.options).toHaveLength(6);
    expect(ServerEnvelopeSchema.options).toHaveLength(6);
  });

  test('diagnostic subscriptions remain transport control and diagnostic events retain request correlation', () => {
    const subscription = {
      type: 'client.diagnostics.subscribe' as const,
      id: MessageId('diagnostic-control'),
      sessionId: SessionId('session-1'),
      enabled: true,
      includeContent: false,
    };
    expect(decodeClientEnvelope(subscription)).toEqual(ok(subscription));
    const frame = {
      type: 'engine.diagnostics.event' as const,
      event: {
        id: 'event-1',
        kind: 'engine.planner.attempt',
        sessionId: 'session-1',
        requestId: 'request-1',
        at: 1,
        metadata: { attempt: 1 },
      },
    };
    expect(decodeServerEnvelope(frame)).toEqual(ok(frame));
    expect(
      decodeServerEnvelope({
        ...frame,
        event: { ...frame.event, metadata: { attempt: Infinity } },
      }).ok,
    ).toBe(false);
  });
});

describe('split-shaped instance ids reaching the envelope boundary', () => {
  test('a split-shaped execution-plan id decodes without error', () => {
    const decoded = decodeServerEnvelope({
      type: 'engine.maelstrom.response',
      requestId: 'req-1',
      response: {
        ...validMaelstromResponse(),
        executionPlan: [{ instanceId: 'H:hero', action: 'open' }],
      },
    });
    expect(isErr(decoded)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Agent wire wrapper frames
// ---------------------------------------------------------------------------

describe('client.agent.input', () => {
  const msg = AgentInputMessage({
    sessionId: SessionId('s-1'),
    id: MessageId('m-ai'),
    input: {
      type: 'utterance',
      version: AGENT_WIRE_VERSION,
      inputId: MessageId('in-1'),
      text: 'show my calendar',
      chart: validChartRequest(),
      source: 'text',
    },
  });

  test('smart constructor generates an id when omitted', () => {
    const generated = AgentInputMessage({
      sessionId: SessionId('s-1'),
      input: msg.input,
    });
    expect(generated.type).toBe('client.agent.input');
    expect(generated.id.length).toBeGreaterThan(0);
  });

  test('round-trips through a JSON string', () => {
    expect(decodeClientEnvelope(encodeEnvelope(msg))).toEqual(ok(msg));
  });

  test('round-trips through a Uint8Array', () => {
    const bytes = new TextEncoder().encode(encodeEnvelope(msg));
    expect(decodeClientEnvelope(bytes)).toEqual(ok(msg));
  });

  test('round-trips through a pre-parsed object', () => {
    expect(decodeClientEnvelope(JSON.parse(encodeEnvelope(msg)))).toEqual(
      ok(msg),
    );
  });

  test('is not a server frame', () => {
    expect(decodeServerEnvelope(encodeEnvelope(msg)).ok).toBe(false);
  });

  test('rejects a frame without a sessionId', () => {
    const { sessionId: _omit, ...rest } = msg;
    const decoded = decodeClientEnvelope(rest);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('sessionId');
    }
  });
});

describe('engine.agent.event', () => {
  const msg = AgentEventMessage({
    sessionId: SessionId('s-1'),
    id: MessageId('m-ae'),
    event: {
      type: 'message',
      version: AGENT_WIRE_VERSION,
      runId: RunId('run-1'),
      turnId: 'turn-1',
      delta: 'Hello',
    },
  });

  test('smart constructor generates an id when omitted', () => {
    const generated = AgentEventMessage({
      sessionId: SessionId('s-1'),
      event: msg.event,
    });
    expect(generated.type).toBe('engine.agent.event');
    expect(generated.id.length).toBeGreaterThan(0);
  });

  test('round-trips through a JSON string', () => {
    expect(decodeServerEnvelope(encodeEnvelope(msg))).toEqual(ok(msg));
  });

  test('round-trips through a Uint8Array', () => {
    const bytes = new TextEncoder().encode(encodeEnvelope(msg));
    expect(decodeServerEnvelope(bytes)).toEqual(ok(msg));
  });

  test('round-trips through a pre-parsed object', () => {
    expect(decodeServerEnvelope(JSON.parse(encodeEnvelope(msg)))).toEqual(
      ok(msg),
    );
  });

  test('is not a client frame', () => {
    expect(decodeClientEnvelope(encodeEnvelope(msg)).ok).toBe(false);
  });

  test('rejects a frame without a sessionId', () => {
    const { sessionId: _omit, ...rest } = msg;
    const decoded = decodeServerEnvelope(rest);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.kind).toBe('invalid_envelope');
      expect(decoded.error.message).toContain('sessionId');
    }
  });
});
