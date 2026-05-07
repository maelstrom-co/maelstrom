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
});
