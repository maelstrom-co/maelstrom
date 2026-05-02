import { describe, expect, test } from 'bun:test';

import { MessageId } from './message.js';
import { SessionId } from './session.js';
import type { ChartRequest } from './request.js';
import {
  AssistantInjectionMessage,
  AssistantInjectionMessageSchema,
  ChartRequestMessage,
  ChartRequestMessageSchema,
  EngineMessageSchema,
  type EngineMessage,
} from './engine-message.js';

const stubRequest = {} as ChartRequest;

describe('ChartRequestMessage factory', () => {
  test('sets type discriminator to chart_request', () => {
    const msg = ChartRequestMessage({
      sessionId: SessionId('s-1'),
      request: stubRequest,
    });
    expect(msg.type).toBe('chart_request');
  });

  test('preserves the sessionId and request payload', () => {
    const sessionId = SessionId('s-1');
    const msg = ChartRequestMessage({ sessionId, request: stubRequest });
    expect(msg.sessionId).toBe(sessionId);
    expect(msg.request).toBe(stubRequest);
  });

  test('generates a fresh MessageId when id is omitted', () => {
    const a = ChartRequestMessage({
      sessionId: SessionId('s'),
      request: stubRequest,
    });
    const b = ChartRequestMessage({
      sessionId: SessionId('s'),
      request: stubRequest,
    });
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('uses the provided id when given', () => {
    const id = MessageId('msg-42');
    const msg = ChartRequestMessage({
      sessionId: SessionId('s'),
      request: stubRequest,
      id,
    });
    expect(msg.id).toBe(id);
  });

  test('defaults timestamp to Date.now() when omitted', () => {
    const before = Date.now();
    const msg = ChartRequestMessage({
      sessionId: SessionId('s'),
      request: stubRequest,
    });
    const after = Date.now();
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.timestamp).toBeLessThanOrEqual(after);
  });

  test('uses the provided timestamp when given', () => {
    const msg = ChartRequestMessage({
      sessionId: SessionId('s'),
      request: stubRequest,
      timestamp: 1_700_000_000_000,
    });
    expect(msg.timestamp).toBe(1_700_000_000_000);
  });

  test.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('throws when timestamp is non-finite (%p)', (timestamp) => {
    expect(() =>
      ChartRequestMessage({
        sessionId: SessionId('s'),
        request: stubRequest,
        timestamp,
      }),
    ).toThrow(/finite number/i);
  });
});

describe('AssistantInjectionMessage factory', () => {
  test('sets type discriminator to assistant_message', () => {
    const msg = AssistantInjectionMessage({
      sessionId: SessionId('s'),
      content: 'hello',
    });
    expect(msg.type).toBe('assistant_message');
  });

  test('preserves sessionId and content', () => {
    const sessionId = SessionId('s-1');
    const msg = AssistantInjectionMessage({ sessionId, content: 'hi there' });
    expect(msg.sessionId).toBe(sessionId);
    expect(msg.content).toBe('hi there');
  });

  test('generates a fresh MessageId when id is omitted', () => {
    const a = AssistantInjectionMessage({
      sessionId: SessionId('s'),
      content: 'a',
    });
    const b = AssistantInjectionMessage({
      sessionId: SessionId('s'),
      content: 'b',
    });
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('uses the provided id when given', () => {
    const id = MessageId('msg-42');
    const msg = AssistantInjectionMessage({
      sessionId: SessionId('s'),
      content: 'hi',
      id,
    });
    expect(msg.id).toBe(id);
  });

  test('defaults timestamp to Date.now() when omitted', () => {
    const before = Date.now();
    const msg = AssistantInjectionMessage({
      sessionId: SessionId('s'),
      content: 'hi',
    });
    const after = Date.now();
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.timestamp).toBeLessThanOrEqual(after);
  });

  test('uses the provided timestamp when given', () => {
    const msg = AssistantInjectionMessage({
      sessionId: SessionId('s'),
      content: 'hi',
      timestamp: 1_700_000_000_000,
    });
    expect(msg.timestamp).toBe(1_700_000_000_000);
  });

  test.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('throws when timestamp is non-finite (%p)', (timestamp) => {
    expect(() =>
      AssistantInjectionMessage({
        sessionId: SessionId('s'),
        content: 'hi',
        timestamp,
      }),
    ).toThrow(/finite number/i);
  });
});

describe('EngineMessage discriminated union', () => {
  test('narrows on the type discriminator', () => {
    const msg: EngineMessage = ChartRequestMessage({
      sessionId: SessionId('s'),
      request: stubRequest,
    });
    if (msg.type === 'chart_request') {
      expect(msg.request).toBe(stubRequest);
    } else {
      // If the branch were wrong, the type narrowing test would fail to compile.
      throw new Error('expected chart_request variant');
    }
  });
});

const validChartRequestEnvelope = () => ({
  type: 'chart_request' as const,
  sessionId: 'sess-1',
  id: 'msg-1',
  timestamp: 1_700_000_000_000,
  request: {
    type: 'chart_request' as const,
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'hi' }],
      chartDimensions: { rows: 12, columns: 16 },
      layoutMode: 'grid' as const,
    },
    instances: [],
    vessels: [],
    layout: { positions: [] },
  },
});

const validAssistantInjectionEnvelope = () => ({
  type: 'assistant_message' as const,
  sessionId: 'sess-1',
  id: 'msg-2',
  timestamp: 1_700_000_000_000,
  content: 'hello world',
});

describe('ChartRequestMessageSchema', () => {
  test('parses a valid envelope', () => {
    expect(
      ChartRequestMessageSchema.safeParse(validChartRequestEnvelope()).success,
    ).toBe(true);
  });

  test('rejects empty sessionId', () => {
    const env = { ...validChartRequestEnvelope(), sessionId: '' };
    expect(ChartRequestMessageSchema.safeParse(env).success).toBe(false);
  });

  test('rejects empty id', () => {
    const env = { ...validChartRequestEnvelope(), id: '' };
    expect(ChartRequestMessageSchema.safeParse(env).success).toBe(false);
  });

  test('rejects NaN timestamp', () => {
    const env = { ...validChartRequestEnvelope(), timestamp: Number.NaN };
    expect(ChartRequestMessageSchema.safeParse(env).success).toBe(false);
  });

  test('rejects +Infinity timestamp', () => {
    const env = { ...validChartRequestEnvelope(), timestamp: Number.POSITIVE_INFINITY };
    expect(ChartRequestMessageSchema.safeParse(env).success).toBe(false);
  });

  test('rejects -Infinity timestamp', () => {
    const env = { ...validChartRequestEnvelope(), timestamp: Number.NEGATIVE_INFINITY };
    expect(ChartRequestMessageSchema.safeParse(env).success).toBe(false);
  });

  test('rejects string timestamp', () => {
    const env = { ...validChartRequestEnvelope(), timestamp: '123' as unknown as number };
    expect(ChartRequestMessageSchema.safeParse(env).success).toBe(false);
  });

  test('rejects malformed inner request', () => {
    const env = {
      ...validChartRequestEnvelope(),
      request: { ...validChartRequestEnvelope().request, context: { /* missing fields */ } },
    };
    expect(ChartRequestMessageSchema.safeParse(env).success).toBe(false);
  });

  test('strips extra top-level fields', () => {
    const env = { ...validChartRequestEnvelope(), extra: 'x' };
    const result = ChartRequestMessageSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('extra' in result.data).toBe(false);
    }
  });
});

describe('AssistantInjectionMessageSchema', () => {
  test('parses a valid envelope', () => {
    expect(
      AssistantInjectionMessageSchema.safeParse(validAssistantInjectionEnvelope())
        .success,
    ).toBe(true);
  });

  test('rejects empty content', () => {
    const env = { ...validAssistantInjectionEnvelope(), content: '' };
    expect(AssistantInjectionMessageSchema.safeParse(env).success).toBe(false);
  });

  test('rejects missing content', () => {
    const env = validAssistantInjectionEnvelope();
    delete (env as { content?: string }).content;
    expect(AssistantInjectionMessageSchema.safeParse(env).success).toBe(false);
  });

  test('rejects NaN timestamp', () => {
    const env = { ...validAssistantInjectionEnvelope(), timestamp: Number.NaN };
    expect(AssistantInjectionMessageSchema.safeParse(env).success).toBe(false);
  });
});

describe('EngineMessageSchema (discriminated union)', () => {
  test('parses chart_request', () => {
    expect(EngineMessageSchema.safeParse(validChartRequestEnvelope()).success).toBe(true);
  });

  test('parses assistant_message', () => {
    expect(EngineMessageSchema.safeParse(validAssistantInjectionEnvelope()).success).toBe(true);
  });

  test('rejects unknown discriminator', () => {
    const env = { ...validChartRequestEnvelope(), type: 'audio_intent' };
    expect(EngineMessageSchema.safeParse(env).success).toBe(false);
  });

  test('rejects missing discriminator', () => {
    const env = validChartRequestEnvelope();
    delete (env as { type?: string }).type;
    expect(EngineMessageSchema.safeParse(env).success).toBe(false);
  });

  test('issue path[0] is "sessionId" when sessionId is empty', () => {
    const env = { ...validChartRequestEnvelope(), sessionId: '' };
    const result = EngineMessageSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const first = result.error.issues[0];
      expect(first?.path[0]).toBe('sessionId');
    }
  });

  test('issue path[0] is "request" when inner payload fails', () => {
    const env = {
      ...validChartRequestEnvelope(),
      request: { ...validChartRequestEnvelope().request, context: {} },
    };
    const result = EngineMessageSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const first = result.error.issues[0];
      expect(first?.path[0]).toBe('request');
    }
  });
});
