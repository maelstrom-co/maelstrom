import { describe, expect, test } from 'bun:test';

import {
  createInitialSTTSessionManagerState,
  deriveSTTSessionManagerPhase,
} from './stt-session-manager.state.js';

describe('stt-session-manager.state', () => {
  test('starts with discriminated foreground, reconnect, and circuit states', () => {
    const state = createInitialSTTSessionManagerState();

    expect(state.phase).toBe('idle');
    expect(state.foreground.kind).toBe('idle');
    expect(state.reconnect.kind).toBe('idle');
    expect(state.circuit.kind).toBe('closed');
  });

  test('derives lifecycle phase from foreground, reconnect, and circuit transitions', () => {
    expect(
      deriveSTTSessionManagerPhase({
        foreground: { kind: 'starting', promise: Promise.resolve() },
        reconnect: { kind: 'idle', attempts: 0, resetTimeout: null },
        circuit: { kind: 'closed' },
      }),
    ).toBe('starting');

    expect(
      deriveSTTSessionManagerPhase({
        foreground: { kind: 'idle' },
        reconnect: {
          kind: 'waiting',
          attempts: 1,
          promise: Promise.resolve(),
          delayResolve: null,
          delayTimeout: null,
          resetTimeout: null,
        },
        circuit: { kind: 'half_open' },
      }),
    ).toBe('reconnecting');

    expect(
      deriveSTTSessionManagerPhase({
        foreground: { kind: 'idle' },
        reconnect: { kind: 'idle', attempts: 0, resetTimeout: null },
        circuit: { kind: 'open', cooldownTimeout: null },
      }),
    ).toBe('circuit_open');
  });
});
