import { WireEngineError } from '@maelstrom-co/client';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { LiveTransportError } from '@maelstrom-co/realtime-protocol/openai-live';
import { describe, expect, it } from 'vitest';
import { isInvalidKeyError, isLiveInvalidKeyError } from './invalid-key-error';

describe('isInvalidKeyError', () => {
  it.each([
    '401 invalid API key',
    'Incorrect API key provided',
    'Provider returned 401',
  ])('recognises a provider rejection of the key: %s', (message) => {
    expect(
      isInvalidKeyError(new WireEngineError(message, 'ProviderError')),
    ).toBe(true);
  });

  it('ignores provider failures unrelated to the key', () => {
    expect(
      isInvalidKeyError(new WireEngineError('429 rate limit', 'ProviderError')),
    ).toBe(false);
  });

  it('ignores key-shaped messages outside a provider failure', () => {
    expect(isInvalidKeyError(new Error('401 invalid API key'))).toBe(false);
    expect(
      isInvalidKeyError(new WireEngineError('401 invalid API key', 'Timeout')),
    ).toBe(false);
  });
});

describe('isLiveInvalidKeyError', () => {
  const liveFailure = (cause: unknown) =>
    new RealtimeVoiceError(
      'CONNECTION_FAILED',
      'Live connection failed',
      cause,
    );

  it('recognises a Live exchange the key could not authorize', () => {
    expect(
      isLiveInvalidKeyError(
        liveFailure(
          new LiveTransportError('exchange_rejected', { status: 401 }),
        ),
      ),
    ).toBe(true);
  });

  it('recognises a Live connect attempted without a key', () => {
    expect(
      isLiveInvalidKeyError(liveFailure(new LiveTransportError('missing_key'))),
    ).toBe(true);
  });

  it('ignores Live failures unrelated to the key', () => {
    expect(
      isLiveInvalidKeyError(
        liveFailure(
          new LiveTransportError('exchange_rejected', { status: 429 }),
        ),
      ),
    ).toBe(false);
    expect(
      isLiveInvalidKeyError(
        liveFailure(new LiveTransportError('connection_lost')),
      ),
    ).toBe(false);
    expect(isLiveInvalidKeyError(liveFailure(new Error('401')))).toBe(false);
  });

  it('ignores other voice error codes and bare transport errors', () => {
    const unauthorized = new LiveTransportError('exchange_rejected', {
      status: 401,
    });
    expect(
      isLiveInvalidKeyError(
        new RealtimeVoiceError(
          'TOKEN_MINT_FAILED',
          'mint failed',
          unauthorized,
        ),
      ),
    ).toBe(false);
    expect(isLiveInvalidKeyError(unauthorized)).toBe(false);
    expect(isLiveInvalidKeyError(undefined)).toBe(false);
  });
});
