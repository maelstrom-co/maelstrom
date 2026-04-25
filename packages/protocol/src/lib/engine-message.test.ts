import { describe, expect, test } from 'bun:test';

import { MessageId } from './message.js';
import { SessionId } from './session.js';
import type { ChartRequest } from './request.js';
import {
  AssistantInjectionMessage,
  ChartRequestMessage,
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

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'throws when timestamp is non-finite (%p)',
    (timestamp) => {
      expect(() =>
        ChartRequestMessage({
          sessionId: SessionId('s'),
          request: stubRequest,
          timestamp,
        }),
      ).toThrow(/finite number/i);
    },
  );
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

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'throws when timestamp is non-finite (%p)',
    (timestamp) => {
      expect(() =>
        AssistantInjectionMessage({
          sessionId: SessionId('s'),
          content: 'hi',
          timestamp,
        }),
      ).toThrow(/finite number/i);
    },
  );
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
