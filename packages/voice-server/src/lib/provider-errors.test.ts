import { describe, expect, spyOn, test } from 'bun:test';

import {
  classifySTTError,
  classifyTTSError,
  createSTTError,
  createTTSError,
} from './provider-errors.js';
import type { VoiceProviderErrorKind } from './types.js';

type ClassifierCase = {
  name: string;
  error: unknown;
  expectedKind: VoiceProviderErrorKind;
};

type FactoryCase = {
  name: string;
  create: (
    provider: string,
    kind: VoiceProviderErrorKind,
    message: string,
    cause?: unknown,
  ) => ReturnType<typeof createSTTError> | ReturnType<typeof createTTSError>;
  source: 'stt' | 'tts';
  provider: string;
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
    name: 'classifies grpc permission denied code as auth',
    error: Object.assign(new Error('Provider denied this request'), {
      code: 7,
    }),
    expectedKind: 'auth',
  },
  {
    name: 'classifies grpc unauthenticated code as auth',
    error: Object.assign(new Error('Token expired while connecting'), {
      code: 16,
    }),
    expectedKind: 'auth',
  },
  {
    name: 'classifies explicit quota status 429 as quota',
    error: Object.assign(new Error('Too many requests'), { status: 429 }),
    expectedKind: 'quota',
  },
  {
    name: 'classifies grpc resource exhausted code as quota',
    error: Object.assign(new Error('provider throttled request'), {
      code: 8,
    }),
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
    name: 'classifies mixed quota and timeout wording as quota',
    error: new Error('rate limit: timeout retrying'),
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
    name: 'classifies status-only 500 objects as server',
    error: { status: 500 },
    expectedKind: 'server',
  },
  {
    name: 'classifies status-only 503 objects as server',
    error: { status: 503 },
    expectedKind: 'server',
  },
  {
    name: 'classifies status-only 599 objects as server',
    error: { status: 599 },
    expectedKind: 'server',
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
    name: 'classifies status-only 400 objects as parse',
    error: { status: 400 },
    expectedKind: 'parse',
  },
  {
    name: 'classifies auth wording as auth even when status 400 is present',
    error: Object.assign(new Error('Authentication failed: invalid api key'), {
      status: 400,
    }),
    expectedKind: 'auth',
  },
  {
    name: 'classifies auth wording as auth before generic status-only 5xx server fallback',
    error: Object.assign(new Error('Authentication failed: invalid api key'), {
      status: 503,
    }),
    expectedKind: 'auth',
  },
  {
    name: 'classifies grpc internal code as server',
    error: Object.assign(new Error('internal provider failure'), {
      code: 13,
    }),
    expectedKind: 'server',
  },
  {
    name: 'classifies grpc unavailable code as transport',
    error: Object.assign(new Error('provider unavailable'), {
      code: 14,
    }),
    expectedKind: 'transport',
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
    name: 'classifies status-only 418 objects as unknown',
    error: { status: 418 },
    expectedKind: 'unknown',
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

const factoryCases: FactoryCase[] = [
  {
    name: 'createSTTError preserves explicit factory metadata',
    create: createSTTError,
    source: 'stt',
    provider: 'deepgram',
  },
  {
    name: 'createTTSError preserves explicit factory metadata',
    create: createTTSError,
    source: 'tts',
    provider: 'cartesia',
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
      expect(classifiedError.message).toBe('socket disconnected');
    });

    test('preserves verbose auth wording when wrapping object inputs with message fields', () => {
      const error = {
        message:
          'Authentication failed: Deepgram API key is invalid for this project. Rotate credentials and retry.',
        code: 16,
      };

      const classifiedError = classifySTTError(error, provider);

      expect(classifiedError.message).toBe(error.message);
      expect(classifiedError.kind).toBe('auth');
      expect(classifiedError.provider).toBe(provider);
      expect(classifiedError.source).toBe('stt');
      expect(classifiedError.cause).toBe(error);
    });

    test('emits a structured warning when classification falls back to unknown', () => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(
        () => undefined,
      );

      try {
        const error = {
          status: 418,
          message: 'Totally novel provider failure',
        };

        const classifiedError = classifySTTError(error, provider);

        expect(classifiedError.kind).toBe('unknown');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          'Unclassified voice provider error',
          expect.objectContaining({
            provider,
            source: 'stt',
            status: 418,
            code: undefined,
            message: 'totally novel provider failure',
            error,
          }),
        );
      } finally {
        warnSpy.mockRestore();
      }
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

    test('preserves provider metadata when wrapping non-Error input with a message field', () => {
      const error = {
        message: 'request exceeded quota',
        code: 'resource_exhausted',
      };

      const classifiedError = classifyTTSError(error, provider);

      expect(classifiedError).toBeInstanceOf(Error);
      expect(classifiedError.message).toBe('request exceeded quota');
      expect(classifiedError.kind).toBe('quota');
      expect(classifiedError.provider).toBe(provider);
      expect(classifiedError.source).toBe('tts');
      expect(classifiedError.cause).toBe(error);
    });

    test('preserves verbose subscription overage wording for quota errors', () => {
      const error = {
        message:
          'Subscription overage: your Cartesia plan has exceeded the included character quota. Upgrade billing or wait for the quota window to reset before retrying synthesis.',
        code: 'resource_exhausted',
      };

      const classifiedError = classifyTTSError(error, provider);

      expect(classifiedError.message).toBe(error.message);
      expect(classifiedError.kind).toBe('quota');
      expect(classifiedError.provider).toBe(provider);
      expect(classifiedError.source).toBe('tts');
      expect(classifiedError.cause).toBe(error);
    });

    test('preserves verbose server wording for wrapped object inputs', () => {
      const error = {
        message:
          'Cartesia server error: upstream synthesis worker crashed while generating audio. Retry once the provider service recovers.',
        status: 503,
      };

      const classifiedError = classifyTTSError(error, provider);

      expect(classifiedError.message).toBe(error.message);
      expect(classifiedError.kind).toBe('server');
      expect(classifiedError.provider).toBe(provider);
      expect(classifiedError.source).toBe('tts');
      expect(classifiedError.cause).toBe(error);
    });
  });

  describe('provider error factories', () => {
    test.each(factoryCases)('$name', ({ create, provider, source }) => {
      const cause = { code: 'resource_exhausted' };
      const message = 'Provider quota exceeded: upgrade your subscription.';

      const error = create(provider, 'quota', message, cause);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(message);
      expect(error.kind).toBe('quota');
      expect(error.provider).toBe(provider);
      expect(error.source).toBe(source);
      expect(error.cause).toBe(cause);
    });

    test('createSTTError does not infer kind from message when cause is omitted', () => {
      const error = createSTTError(
        'deepgram',
        'unknown',
        'Authentication failed: invalid api key',
      );

      expect(error.kind).toBe('unknown');
      expect(error.message).toBe('Authentication failed: invalid api key');
      expect(error.cause).toBeUndefined();
    });
  });
});
