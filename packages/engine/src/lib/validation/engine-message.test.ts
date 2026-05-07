import { describe, expect, test } from 'bun:test';

import { isErr, isOk } from '@maelstrom-co/protocol';

import type { Logger } from '../logger.js';
import { logValidationFailure, validateEngineMessage } from './engine-message.js';

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
      expect(result.error.path).toEqual(['sessionId']);
    }
  });

  test('rejects empty sessionId', () => {
    const env = { ...validChartRequestEnvelope(), sessionId: '' };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.path).toEqual(['sessionId']);
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
      expect(result.error.path).toEqual(['sessionId']);
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
      expect(result.error.path).toEqual(['id']);
    }
  });

  test('rejects NaN timestamp', () => {
    const env = { ...validChartRequestEnvelope(), timestamp: Number.NaN };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.path).toEqual(['timestamp']);
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
      expect(result.error.path).toEqual(['timestamp']);
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
      expect(result.error.path).toEqual(['timestamp']);
    }
  });

  test('rejects unknown discriminator', () => {
    const env = { ...validChartRequestEnvelope(), type: 'audio_intent' };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('envelope');
      expect(result.error.path).toEqual(['type']);
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
      expect(result.error.path[0]).toBe('request');
    }
  });

  test('rejects unknown layoutMode', () => {
    const env = validChartRequestEnvelope();
    env.request.context.layoutMode = 'flex' as 'grid' | 'tiling';
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('payload');
      expect(result.error.path).toContain('layoutMode');
    }
  });

  test('rejects empty assistant_message content', () => {
    const env = { ...validAssistantInjectionEnvelope(), content: '' };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.layer).toBe('payload');
      expect(result.error.path).toEqual(['content']);
    }
  });
});

describe('logValidationFailure — payload contract', () => {
  type WarnCall = { msg: string; data: Record<string, unknown> | undefined };

  const captureLogger = () => {
    const calls: WarnCall[] = [];
    const logger: Logger = {
      debug: () => {},
      info: () => {},
      warn: (msg, data) => {
        calls.push({ msg, data });
      },
      error: () => {},
    };
    return { logger, calls };
  };

  // Defends the dashboard-grouping contract: a future revert to `field:` would
  // pass every validation-level test but break log consumers.
  test('emits structured `path` (not `field`) on the warn payload', () => {
    const { logger, calls } = captureLogger();
    const env = { ...validChartRequestEnvelope(), sessionId: '' };
    const result = validateEngineMessage(env);
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    logValidationFailure(logger, env, result.error);

    expect(calls).toHaveLength(1);
    const data = calls[0]?.data;
    expect(data).toBeDefined();
    if (data === undefined) return;
    expect('path' in data).toBe(true);
    expect('field' in data).toBe(false);
    expect(data.path).toEqual(['sessionId']);
    expect(data.layer).toBe('envelope');
    expect(data.issueCount).toBe(result.error.issues.length);
  });

  test('includes `sessionIdCandidate` only when extractable from raw input', () => {
    const { logger, calls } = captureLogger();
    // String-typed sessionId is extractable even when otherwise invalid (here:
    // empty string violates the brand's `.refine`).
    const envWithSession = { ...validChartRequestEnvelope(), sessionId: '' };
    const r1 = validateEngineMessage(envWithSession);
    if (!isErr(r1)) throw new Error('expected failure');
    logValidationFailure(logger, envWithSession, r1.error);
    expect(calls[0]?.data?.sessionIdCandidate).toBe('');

    // Non-object input cannot yield a sessionId candidate; the conditional
    // spread must omit the key entirely (not emit `undefined`).
    const r2 = validateEngineMessage(null);
    if (!isErr(r2)) throw new Error('expected failure');
    logValidationFailure(logger, null, r2.error);
    expect('sessionIdCandidate' in (calls[1]?.data ?? {})).toBe(false);
  });
});
