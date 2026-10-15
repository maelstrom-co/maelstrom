import { describe, expect, test } from 'bun:test';

import type {
  ChartRequest,
  EngineOutput,
  MaelstromResponse,
  Result,
} from '@maelstrom-co/protocol';
import {
  AcknowledgedAssistantMessage,
  AGENT_WIRE_VERSION,
  AgentInputMessage,
  ChartRequestMessage,
  encodeEnvelope,
  err,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';

import type { Engine } from './engine.js';
import { handleEnvelope } from './envelope-handler.js';
import type { EngineError } from './errors.js';
import { historyError, providerError, validationError } from './errors.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

const maelstromResponse = (
  requestId = MessageId('req-1'),
): MaelstromResponse => ({
  type: 'maelstrom_response',
  requestId,
  userMessage: 'done',
  rationale: 'because',
  executionPlan: [],
  layout: { type: 'grid', positions: [] },
});

// The Engine surface is an interface, so a per-test plain object is a complete
// stub — no mocking framework needed. Only the two methods handleEnvelope calls
// are supplied; unused ones throw so an unexpected call is loud, not silent.
const stubEngine = (overrides: Partial<Engine>): Engine => ({
  handle: () => {
    throw new Error('handle not stubbed');
  },
  getHistory: () => {
    throw new Error('getHistory not stubbed');
  },
  ...overrides,
});

const okOutput = (value: EngineOutput): Result<EngineOutput, EngineError> =>
  ok(value);
const errOutput = (error: EngineError): Result<EngineOutput, EngineError> =>
  err(error);

// ---------------------------------------------------------------------------
// chart_request
// ---------------------------------------------------------------------------

describe('handleEnvelope — chart_request', () => {
  test('maps an Ok chart_response to engine.maelstrom.response with correlation passthrough', async () => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('req-1');
    const response = maelstromResponse(messageId);

    const engine = stubEngine({
      handle: async () =>
        okOutput({
          type: 'chart_response',
          sessionId,
          // Deliberately distinct from the request id: the client awaits the
          // request's id, so correlation must key off the envelope, not the
          // engine's echoed output id. Regressing to `result.value.id` fails
          // the requestId assertion below.
          id: MessageId('engine-echoed-different-id'),
          response,
        }),
    });

    const reply = await handleEnvelope(
      engine,
      ChartRequestMessage({
        sessionId,
        id: messageId,
        request: validChartRequest(),
      }),
    );

    expect(reply?.type).toBe('engine.maelstrom.response');
    if (reply?.type !== 'engine.maelstrom.response') return;
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
    // Payload passthrough is by reference — the handler must not reshape it.
    expect(reply.response).toBe(response);
  });

  test('maps a non-chart_response Ok output to engine.error (UnexpectedOutput)', async () => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('req-1');
    const engine = stubEngine({
      handle: async () =>
        okOutput({
          type: 'assistant_message_result',
          sessionId,
          id: MessageId('other-id'),
          outcome: 'inserted',
        }),
    });

    const reply = await handleEnvelope(
      engine,
      ChartRequestMessage({
        sessionId,
        id: messageId,
        request: validChartRequest(),
      }),
    );

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.code).toBe('UnexpectedOutput');
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
  });

  test.each([
    {
      name: 'ProviderError',
      error: providerError('LLM unavailable', new Error('boom')),
      code: 'ProviderError',
      message: 'LLM unavailable',
    },
    {
      name: 'ValidationError',
      error: validationError('bad prompt', 'prompt'),
      code: 'ValidationError',
      message: 'bad prompt',
    },
  ])('maps an engine Err ($name) to engine.error with the tag as code', async ({
    error,
    code,
    message,
  }) => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('req-err');
    const engine = stubEngine({
      handle: async () => errOutput(error),
    });

    const reply = await handleEnvelope(
      engine,
      ChartRequestMessage({
        sessionId,
        id: messageId,
        request: validChartRequest(),
      }),
    );

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
    expect(reply.error).toBe(message);
    expect(reply.code).toBe(code);
  });

  test('does not reject when engine.handle throws — maps to engine.error with no code', async () => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('req-throw');
    const engine = stubEngine({
      handle: async () => {
        throw new Error('engine contract violation');
      },
    });

    const reply = await handleEnvelope(
      engine,
      ChartRequestMessage({
        sessionId,
        id: messageId,
        request: validChartRequest(),
      }),
    );

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.error).toBe('engine contract violation');
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
    // A thrown exception is not an EngineError, so there is no tag to surface.
    expect(reply.code).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// assistant_message
// ---------------------------------------------------------------------------

describe('handleEnvelope — assistant_message', () => {
  test.each([
    'inserted',
    'deduped',
  ] as const)('invokes Engine for a legacy %s result and returns no frame', async (outcome) => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('inj-1');
    let handled = false;
    const engine = stubEngine({
      handle: async (message) => {
        handled = true;
        expect(message.type).toBe('assistant_message');
        return okOutput({
          type: 'assistant_message_result',
          sessionId,
          id: messageId,
          outcome,
        });
      },
    });

    const reply = await handleEnvelope(engine, {
      type: 'assistant_message',
      sessionId,
      id: messageId,
      timestamp: 1,
      content: 'seeded note',
    });

    expect(handled).toBe(true);
    expect(reply).toBeNull();
  });

  test.each([
    {
      name: 'returns an Engine history failure',
      handle: async () =>
        errOutput(validationError('history not configured', 'history')),
    },
    {
      name: 'throws during history insertion',
      handle: async () => {
        throw new Error('history store unavailable');
      },
    },
  ])('$name without emitting a legacy frame', async ({ handle }) => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('inj-1');
    const engine = stubEngine({ handle });

    const reply = await handleEnvelope(engine, {
      type: 'assistant_message',
      sessionId,
      id: messageId,
      timestamp: 1,
      content: 'seeded note',
    });

    expect(reply).toBeNull();
  });
});

describe('handleEnvelope — client.assistant_message.acknowledged', () => {
  test.each([
    'inserted',
    'deduped',
  ] as const)('maps an Ok %s result to a correlated assistant result frame', async (outcome) => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('inj-1');
    const engine = stubEngine({
      handle: async (message) => {
        expect(message.type).toBe('assistant_message');
        return okOutput({
          type: 'assistant_message_result',
          sessionId,
          id: messageId,
          outcome,
        });
      },
    });

    const reply = await handleEnvelope(
      engine,
      AcknowledgedAssistantMessage({
        sessionId,
        id: messageId,
        timestamp: 1,
        content: 'seeded note',
      }),
    );
    expect(reply).toEqual({
      type: 'engine.assistant_message.result',
      requestId: messageId,
      sessionId,
      outcome,
    });
  });

  test('maps an unexpected Ok output type to engine.error UnexpectedOutput', async () => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('inj-1');
    const engine = stubEngine({
      handle: async () =>
        okOutput({
          type: 'chart_response',
          sessionId,
          id: MessageId('other-id'),
          response: maelstromResponse(MessageId('other-id')),
        }),
    });

    const reply = await handleEnvelope(
      engine,
      AcknowledgedAssistantMessage({
        sessionId,
        id: messageId,
        timestamp: 1,
        content: 'seeded note',
      }),
    );

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.code).toBe('UnexpectedOutput');
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
  });

  test('surfaces an engine Err as engine.error correlated to the message id', async () => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('inj-1');
    const engine = stubEngine({
      handle: async () =>
        errOutput(validationError('history not configured', 'history')),
    });

    const reply = await handleEnvelope(
      engine,
      AcknowledgedAssistantMessage({
        sessionId,
        id: messageId,
        timestamp: 1,
        content: 'seeded note',
      }),
    );

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
    expect(reply.error).toBe('history not configured');
    expect(reply.code).toBe('ValidationError');
  });

  test('maps a thrown insertion failure to a correlated engine.error', async () => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('inj-throw');
    const engine = stubEngine({
      handle: async () => {
        throw new Error('history store unavailable');
      },
    });

    const reply = await handleEnvelope(
      engine,
      AcknowledgedAssistantMessage({
        sessionId,
        id: messageId,
        timestamp: 1,
        content: 'seeded note',
      }),
    );

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
    expect(reply.error).toBe('history store unavailable');
    expect(reply.code).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// client.history.get
// ---------------------------------------------------------------------------

describe('handleEnvelope — client.history.get', () => {
  test('maps an Ok to engine.history.response with the entries', async () => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('hist-1');
    const entries = [
      {
        kind: 'injection' as const,
        id: MessageId('inj-1'),
        sessionId,
        timestamp: 1,
        content: 'seeded',
      },
    ];
    const engine = stubEngine({
      getHistory: async () => ok(entries),
    });

    const reply = await handleEnvelope(engine, {
      type: 'client.history.get',
      id: messageId,
      sessionId,
    });

    expect(reply?.type).toBe('engine.history.response');
    if (reply?.type !== 'engine.history.response') return;
    expect(reply.requestId).toBe(messageId);
    expect(reply.entries).toBe(entries);
  });

  test('maps an engine Err to engine.error with the tag as code', async () => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('hist-1');
    const engine = stubEngine({
      getHistory: async () =>
        err(historyError.getHistory('store down', new Error('down'))),
    });

    const reply = await handleEnvelope(engine, {
      type: 'client.history.get',
      id: messageId,
      sessionId,
    });

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
    expect(reply.error).toBe('store down');
    expect(reply.code).toBe('HistoryError');
  });
});

// ---------------------------------------------------------------------------
// client.agent.input
// ---------------------------------------------------------------------------

describe('handleEnvelope: client.agent.input', () => {
  test('answers with a correlated engine.error without calling the engine', async () => {
    const sessionId = SessionId('sess-1');
    const messageId = MessageId('agent-1');

    const reply = await handleEnvelope(
      stubEngine({}),
      encodeEnvelope(
        AgentInputMessage({
          sessionId,
          id: messageId,
          input: {
            type: 'utterance',
            version: AGENT_WIRE_VERSION,
            inputId: MessageId('in-1'),
            text: 'show my calendar',
            chart: validChartRequest(),
            source: 'text',
          },
        }),
      ),
    );

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
    expect(reply.error).toBe('agent inputs are not supported yet');
    expect(reply.code).toBe('UnsupportedInput');
  });
});

// ---------------------------------------------------------------------------
// Undecodable input
// ---------------------------------------------------------------------------

describe('handleEnvelope — decode failures', () => {
  const neverCalled = stubEngine({});

  test('malformed JSON string → engine.error, code invalid_json, no requestId', async () => {
    const reply = await handleEnvelope(neverCalled, '{ not json');

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.code).toBe('invalid_json');
    expect(reply.requestId).toBeUndefined();
    expect(reply.sessionId).toBeUndefined();
  });

  test('valid JSON, unknown type, recoverable id → engine.error, code invalid_envelope, requestId recovered', async () => {
    const reply = await handleEnvelope(neverCalled, {
      type: 'totally.unknown',
      id: 'req-recover',
      sessionId: 'sess-recover',
    });

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.code).toBe('invalid_envelope');
    expect(reply.requestId).toBe(MessageId('req-recover'));
    expect(reply.sessionId).toBe(SessionId('sess-recover'));
  });

  test('empty-string id → no requestId, does not throw on branding', async () => {
    const reply = await handleEnvelope(neverCalled, {
      type: 'totally.unknown',
      id: '',
      sessionId: '',
    });

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.code).toBe('invalid_envelope');
    expect(reply.requestId).toBeUndefined();
    expect(reply.sessionId).toBeUndefined();
  });

  test('whitespace-only id → no requestId, does not reject on branding', async () => {
    const reply = await handleEnvelope(neverCalled, {
      type: 'totally.unknown',
      id: '   ',
      sessionId: '   ',
    });

    expect(reply?.type).toBe('engine.error');
    if (reply?.type !== 'engine.error') return;
    expect(reply.code).toBe('invalid_envelope');
    expect(reply.requestId).toBeUndefined();
    expect(reply.sessionId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Wire-string round-trip
// ---------------------------------------------------------------------------

describe('handleEnvelope — wire string input', () => {
  test('decodes an encoded ChartRequestMessage string and dispatches it', async () => {
    const sessionId = SessionId('sess-wire');
    const messageId = MessageId('req-wire');
    const response = maelstromResponse(messageId);

    const engine = stubEngine({
      handle: async () =>
        okOutput({
          type: 'chart_response',
          sessionId,
          id: messageId,
          response,
        }),
    });

    const wire = encodeEnvelope(
      ChartRequestMessage({
        sessionId,
        id: messageId,
        request: validChartRequest(),
      }),
    );
    expect(typeof wire).toBe('string');

    const reply = await handleEnvelope(engine, wire);

    expect(reply?.type).toBe('engine.maelstrom.response');
    if (reply?.type !== 'engine.maelstrom.response') return;
    expect(reply.requestId).toBe(messageId);
    expect(reply.sessionId).toBe(sessionId);
    expect(reply.response).toBe(response);
  });
});
