import { describe, expect, it } from 'bun:test';

import { makeHarness } from './__test-helpers__/realtime-session-harness.js';
import type { AdapterTurnControl } from './provider-adapter.types.js';

describe('RealtimeSession turn mode switching', () => {
  it('delegates a switchable control in either mode so the UI can change mode', async () => {
    const { session, adapter } = makeHarness();
    const switchable: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
      setTurnMode: async () => {},
    };
    adapter.setTurnControl(switchable);
    await session.connect();

    expect(session.turnMode).toBe('automatic');
    expect(session.turnControl).toBe(switchable);

    adapter.emitTurnMode('manual');
    expect(session.turnControl).toBe(switchable);

    adapter.emitTurnMode('automatic');
    expect(session.turnControl).toBe(switchable);

    adapter.setTurnControl(undefined);
    expect(session.turnControl).toBeUndefined();
  });
});
