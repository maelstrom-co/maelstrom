import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';

import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import type {
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
  Unsubscribe,
  VoiceSession,
  VoiceSessionState,
} from '@maelstrom-co/client';
import type { ChartRequestMessage, MaelstromResponse } from '@maelstrom-co/protocol';
import type { VoiceSpikeApi } from './voice-spike.js';

// Fakes the module boundary voice-spike.ts constructs against — RealtimeSession
// is never real here, so the assertions below observe voice-spike's own
// lifecycle wiring (WeakMap reuse, refcounting) rather than the realtime
// package's internals.
class FakeRealtimeSession implements VoiceSession {
  static instances: FakeRealtimeSession[] = [];

  state: VoiceSessionState = 'idle';
  connectCalls = 0;
  disconnectCalls = 0;
  readonly #handlers = new Set<(s: VoiceSessionState) => void>();

  constructor(readonly options: unknown) {
    FakeRealtimeSession.instances.push(this);
  }

  on(_event: 'state', handler: (s: VoiceSessionState) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  async connect(): Promise<void> {
    this.connectCalls++;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++;
  }

  emitState(next: VoiceSessionState): void {
    this.state = next;
    for (const handler of this.#handlers) handler(next);
  }
}

mock.module('@maelstrom-co/realtime', () => ({
  RealtimeSession: FakeRealtimeSession,
}));

mock.module('@maelstrom-co/realtime/openai', () => ({
  createOpenAiAdapter: () => ({}),
}));

mock.module('./mint-token', () => ({
  mintOpenAiToken: async () => {
    throw new Error('mintOpenAiToken should not be called in tests');
  },
}));

const { voiceSpike } = await import('./voice-spike.js');

const testVessel = defineVessel({
  id: 'voice-spike-test-vessel',
  name: 'Voice Spike Test Vessel',
  description: 'Minimal vessel to satisfy createMaelstrom in voice-spike hook tests',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [],
    },
  },
});

function createMockConnector(): EngineConnector {
  const subscribers: Array<(event: ConnectorEvent) => void> = [];

  return {
    capabilities: { voice: false, streaming: false, stateful: false } satisfies ConnectorCapabilities,

    async connect() {
      // no-op
    },

    async disconnect() {
      for (const handler of subscribers) {
        handler({ type: 'disconnected', clean: true, message: 'test disconnect' });
      }
    },

    async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
      return {
        type: 'maelstrom_response',
        requestId: message.id,
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      };
    },

    subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
      subscribers.push(handler);
      return () => {
        const idx = subscribers.indexOf(handler);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },

    async addAssistantMessage() {
      // no-op
    },

    async getHistory() {
      return [];
    },
  };
}

function setup() {
  const entry = vessel(testVessel, () => null);
  const m = createMaelstrom({ vessels: [entry] }).with(voiceSpike());
  const connector = createMockConnector();
  return { m, connector };
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected value to be defined');
  return value;
}

beforeEach(() => {
  FakeRealtimeSession.instances = [];
});

afterEach(() => {
  cleanup();
});

describe('voiceSpike() useVoiceSpike lifecycle', () => {
  it('reuses the same session across mount, unmount, and remount', async () => {
    const { m, connector } = setup();
    let api: VoiceSpikeApi | undefined;
    function Consumer() {
      api = m.useVoiceSpike();
      return null;
    }

    let rerender!: (ui: ReactNode) => void;
    await act(async () => {
      ({ rerender } = render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      ));
    });

    expect(FakeRealtimeSession.instances).toHaveLength(1);
    const session = must(FakeRealtimeSession.instances[0]);
    expect(api).toBeDefined();

    // Unmount the consumer; the Provider (and its Orchestrator) stays mounted.
    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
    });
    expect(session.disconnectCalls).toBe(1);

    // Remount under the same Provider/orchestrator.
    api = undefined;
    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(FakeRealtimeSession.instances).toHaveLength(1);
    expect(FakeRealtimeSession.instances[0]).toBe(session);
    expect(api).toBeDefined();
  });

  it('constructs exactly one session under StrictMode double-mount', async () => {
    const { m, connector } = setup();
    let api: VoiceSpikeApi | undefined;
    let renderCount = 0;
    function Consumer() {
      renderCount++;
      api = m.useVoiceSpike();
      return null;
    }

    // StrictMode wraps the Provider too, not just Consumer — nesting
    // StrictMode below a (non-strict) Context.Provider does not propagate
    // React's double-effect-invocation to descendants, so wrapping only the
    // consumer would silently fail to exercise it. Wrapping the whole tree
    // does double-invoke both the Provider's orchestrator-creation effect
    // and the hook's own effects; because Provider gates rendering behind
    // its orchestrator state (renders null until the effect resolves), the
    // transient first orchestrator instance never reaches a committed
    // render, so exactly one orchestrator — and one voice session — is
    // ever observed here.
    await act(async () => {
      render(
        <StrictMode>
          <m.Provider connector={connector}>
            <Consumer />
          </m.Provider>
        </StrictMode>,
      );
    });

    // Sanity check that StrictMode's render-phase double-invocation
    // actually fired here — otherwise this test would trivially pass
    // without exercising the remount path it's meant to cover.
    expect(renderCount).toBeGreaterThanOrEqual(2);

    expect(FakeRealtimeSession.instances).toHaveLength(1);
    expect(api).toBeDefined();

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      await must(api).connect();
    });
    expect(session.connectCalls).toBeGreaterThan(0);
  });

  it('disconnects only once when two consumers unmount close together', async () => {
    const { m, connector } = setup();
    function ConsumerA() {
      m.useVoiceSpike();
      return null;
    }
    function ConsumerB() {
      m.useVoiceSpike();
      return null;
    }

    // Both consumers keep a stable position across rerenders (toggled via
    // `null`, never removed from the children list) so React doesn't
    // reconcile ConsumerB into ConsumerA's slot and spuriously
    // unmount/remount it — that positional diffing artifact would produce
    // an extra disconnect unrelated to the hook's own refcounting.
    let rerender!: (ui: ReactNode) => void;
    await act(async () => {
      ({ rerender } = render(
        <m.Provider connector={connector}>
          <ConsumerA />
          <ConsumerB />
        </m.Provider>,
      ));
    });

    expect(FakeRealtimeSession.instances).toHaveLength(1);
    const session = must(FakeRealtimeSession.instances[0]);

    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          {null}
          <ConsumerB />
        </m.Provider>,
      );
    });
    expect(session.disconnectCalls).toBe(0);

    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          {null}
          {null}
        </m.Provider>,
      );
    });
    expect(session.disconnectCalls).toBe(1);
  });

  it('propagates session state changes to the hook consumer', async () => {
    const { m, connector } = setup();
    let api: VoiceSpikeApi | undefined;
    function Consumer() {
      api = m.useVoiceSpike();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(must(api).state).toBe('idle');
    const session = must(FakeRealtimeSession.instances[0]);

    await act(async () => {
      session.emitState('connected');
    });

    expect(must(api).state).toBe('connected');
  });
});
