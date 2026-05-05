import { describe, expect, test } from 'bun:test';

import { classifySTTError, classifyTTSError } from './provider-errors.js';
import type { VoiceProviderErrorKind } from './types.js';

type ClassifierCase = {
  name: string;
  error: unknown;
  expectedKind: VoiceProviderErrorKind;
};

const classifierCases: ClassifierCase[] = [
  {
    name: 'classifies explicit auth status 401 as auth',
    error: Object.assign(new Error('Unauthorized'), { status: 401 }),
    expectedKind: 'auth',
  },
  {
    name: 'classifies explicit auth status 403 as auth',
    error: Object.assign(new Error('Forbidden'), { status: 403 }),
    expectedKind: 'auth',
  },
  {
    name: 'classifies explicit quota status 429 as quota',
    error: Object.assign(new Error('Too many requests'), { status: 429 }),
    expectedKind: 'quota',
  },
  {
    name: 'classifies explicit auth code as auth even when transport wording is present',
    error: Object.assign(
      new Error(
        'WebSocket closed unexpectedly: token expired during reconnect',
      ),
      { code: 'unauthenticated' },
    ),
    expectedKind: 'auth',
  },
  {
    name: 'classifies mixed transport and auth wording as transport without explicit auth status or code',
    error: new Error(
      'WebSocket closed unexpectedly: 401 Unauthorized — token expired',
    ),
    expectedKind: 'transport',
  },
  {
    name: 'classifies message-only rate limit wording as quota',
    error: new Error('Provider rate limit exceeded for this voice request'),
    expectedKind: 'quota',
  },
  {
    name: 'classifies resource_exhausted code as quota',
    error: Object.assign(new Error('provider throttled request'), {
      code: 'resource_exhausted',
    }),
    expectedKind: 'quota',
  },
  {
    name: 'classifies malformed JSON messages as parse',
    error: new Error('Malformed JSON payload from provider'),
    expectedKind: 'parse',
  },
  {
    name: 'classifies unsupported input messages as parse',
    error: new Error('Unsupported audio format for request'),
    expectedKind: 'parse',
  },
  {
    name: 'classifies bad request messages as parse',
    error: new Error('Bad Request: invalid synthesis config'),
    expectedKind: 'parse',
  },
  {
    name: 'classifies upstream failure messages as server',
    error: new Error('upstream failure while synthesizing audio'),
    expectedKind: 'server',
  },
  {
    name: 'classifies server error messages as server',
    error: new Error('Server error from provider'),
    expectedKind: 'server',
  },
  {
    name: 'classifies unrecognized empty messages as unknown',
    error: new Error(''),
    expectedKind: 'unknown',
  },
  {
    name: 'classifies unrecognized generic messages as unknown',
    error: new Error('something odd happened'),
    expectedKind: 'unknown',
  },
];

describe('provider error classifiers', () => {
  describe('classifySTTError', () => {
    const provider = 'deepgram';

    test.each(classifierCases)('$name', ({ error, expectedKind }) => {
      const classifiedError = classifySTTError(error, provider);

      expect(classifiedError.kind).toBe(expectedKind);
      expect(classifiedError.provider).toBe(provider);
      expect(classifiedError.source).toBe('stt');
    });

    test('preserves provider metadata and original error instance', () => {
      const error = Object.assign(new Error('socket disconnected'), {
        statusCode: 503,
      });
      const originalError = error;

      const classifiedError = classifySTTError(error, provider);

      expect(Object.is(classifiedError, originalError)).toBe(true);
      expect(classifiedError.kind).toBe('transport');
      expect(classifiedError.provider).toBe(provider);
      expect(classifiedError.source).toBe('stt');
      expect(classifiedError.cause).toBeUndefined();
    });
  });

  describe('classifyTTSError', () => {
    const provider = 'cartesia';

    test.each(classifierCases)('$name', ({ error, expectedKind }) => {
      const classifiedError = classifyTTSError(error, provider);

      expect(classifiedError.kind).toBe(expectedKind);
      expect(classifiedError.provider).toBe(provider);
      expect(classifiedError.source).toBe('tts');
    });

    test('preserves provider metadata when wrapping non-Error input', () => {
      const error = {
        message: 'request exceeded quota',
        code: 'resource_exhausted',
      };

      const classifiedError = classifyTTSError(error, provider);

      expect(classifiedError).toBeInstanceOf(Error);
      expect(classifiedError.message).toBe('[object Object]');
      expect(classifiedError.kind).toBe('quota');
      expect(classifiedError.provider).toBe(provider);
      expect(classifiedError.source).toBe('tts');
      expect(classifiedError.cause).toBe(error);
    });
  });
});
