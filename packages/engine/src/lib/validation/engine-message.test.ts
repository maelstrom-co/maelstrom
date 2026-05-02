import { describe, expect, test } from 'bun:test';

import { isErr, isOk } from '@maelstrom-co/protocol';

import { validateEngineMessage } from './engine-message.js';

const validChartRequestEnvelope = () => ({
  type: 'chart_request',
  sessionId: 'sess-1',
  id: 'msg-1',
  timestamp: 1_700_000_000_000,
  request: {
    type: 'chart_request',
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'hi' }],
      chartDimensions: { rows: 12, columns: 16 },
      layoutMode: 'grid',
    },
    instances: [],
    vessels: [],
    layout: { positions: [] },
  },
});

const validAssistantInjectionEnvelope = () => ({
  type: 'assistant_message',
  sessionId: 'sess-1',
  id: 'msg-2',
  timestamp: 1_700_000_000_000,
  content: 'hello',
});

describe('validateEngineMessage — success', () => {
  test('returns Ok for a valid chart_request envelope', () => {
    const result = validateEngineMessage(validChartRequestEnvelope());
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.type).toBe('chart_request');
      expect(result.value.sessionId as string).toBe('sess-1');
    }
  });

  test('returns Ok for a valid assistant_message envelope', () => {
    const result = validateEngineMessage(validAssistantInjectionEnvelope());
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.type).toBe('assistant_message');
    }
  });

  test('strips extra envelope fields', () => {
    const env = { ...validChartRequestEnvelope(), extra: 'stripme' };
    const result = validateEngineMessage(env);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect('extra' in result.value).toBe(false);
    }
  });

  test('strips extra fields nested inside the request payload', () => {
    const base = validChartRequestEnvelope();
    const env = {
      ...base,
      request: {
        ...base.request,
        context: {
          ...base.request.context,
          extraContextField: 'should-be-stripped',
        },
      },
    };
    const result = validateEngineMessage(env);
    expect(isOk(result)).toBe(true);
    if (isOk(result) && result.value.type === 'chart_request') {
      expect('extraContextField' in result.value.request.context).toBe(false);
    }
  });
});

describe('validateEngineMessage — envelope rejections', () => {
  test('rejects missing sessionId', () => {
    const env = validChartRequestEnvelope();
    delete (env as { sessionId?: string }).sessionId;
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('RequestValidationError');
      expect(result.error.layer).toBe('envelope');
      expect(result.error.field).toBe('sessionId');
    }
  });

  test('rejects empty sessionId', () => {
    const env = { ...validChartRequestEnvelope(), sessionId: '' };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.field).toBe('sessionId');
    }
  });

  test('rejects whitespace-only sessionId at the validator boundary', () => {
    // The whitespace `.refine()` lives on `SessionIdSchema` (protocol layer),
    // not on the validator itself — this integration-level test ensures the
    // refine survives the `EngineMessageSchema` discriminated-union dispatch.
    const env = { ...validChartRequestEnvelope(), sessionId: '   ' };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.field).toBe('sessionId');
    }
  });

  test('classifies a non-object input as envelope failure', () => {
    // Wire ingress can hand us anything that survived JSON.parse — null,
    // numbers, arrays, strings. None of these is a valid envelope; classify
    // as envelope-layer (not payload) so ops can route correctly.
    for (const input of [null, undefined, 42, 'chart_request', []]) {
      const result = validateEngineMessage(input);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error._tag).toBe('RequestValidationError');
        expect(result.error.layer).toBe('envelope');
      }
    }
  });

  test('rejects empty id', () => {
    const env = { ...validChartRequestEnvelope(), id: '' };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.field).toBe('id');
    }
  });

  test('rejects NaN timestamp', () => {
    const env = { ...validChartRequestEnvelope(), timestamp: Number.NaN };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.field).toBe('timestamp');
    }
  });

  test('rejects +Infinity timestamp', () => {
    const env = {
      ...validChartRequestEnvelope(),
      timestamp: Number.POSITIVE_INFINITY,
    };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.field).toBe('timestamp');
    }
  });

  test('rejects -Infinity timestamp', () => {
    const env = {
      ...validChartRequestEnvelope(),
      timestamp: Number.NEGATIVE_INFINITY,
    };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.field).toBe('timestamp');
    }
  });

  test('rejects unknown discriminator', () => {
    const env = { ...validChartRequestEnvelope(), type: 'audio_intent' };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.field).toBe('type');
    }
  });
});

describe('validateEngineMessage — payload rejections', () => {
  test('rejects missing inner request', () => {
    const env = validChartRequestEnvelope();
    delete (env as { request?: unknown }).request;
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('payload');
      expect(result.error.field.startsWith('request')).toBe(true);
    }
  });

  test('rejects unknown layoutMode', () => {
    const env = validChartRequestEnvelope();
    env.request.context.layoutMode = 'flex' as 'grid' | 'tiling';
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('payload');
      expect(result.error.field).toContain('layoutMode');
    }
  });

  test('rejects empty assistant_message content', () => {
    const env = { ...validAssistantInjectionEnvelope(), content: '' };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('payload');
      expect(result.error.field).toBe('content');
    }
  });
});
