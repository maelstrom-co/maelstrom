import { flattenErrorChain } from './voice-error-format.js';

describe('flattenErrorChain', () => {
  test('flattens a linear cause chain in order', () => {
    const rootCause = new Error('socket closed');
    const providerError = new Error('connection interrupted', {
      cause: rootCause,
    });
    const sessionError = new Error('voice session failed', {
      cause: providerError,
    });

    expect(flattenErrorChain(sessionError)).toBe(
      'voice session failed: connection interrupted: socket closed',
    );
  });

  test('terminates safely when a cause chain becomes cyclic', () => {
    const cyclicError = new Error('cyclic failure');

    Object.defineProperty(cyclicError, 'cause', {
      configurable: true,
      value: cyclicError,
    });

    expect(flattenErrorChain(cyclicError)).toBe('cyclic failure');
  });

  test('extracts message from plain error-like objects (EngineError discriminated union)', () => {
    const historyError = {
      _tag: 'HistoryError',
      message: 'history failed',
      operation: 'add_assistant_message',
      cause: undefined,
    };

    expect(flattenErrorChain(historyError)).toBe('history failed');
  });

  test('walks cause chains across mixed Error and plain error-like objects', () => {
    const providerError = {
      _tag: 'ProviderError',
      message: 'provider exploded',
      cause: new Error('socket closed'),
    };

    expect(flattenErrorChain(providerError)).toBe(
      'provider exploded: socket closed',
    );
  });
});
