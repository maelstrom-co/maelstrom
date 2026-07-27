import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { TranscriptEntry, VoiceSessionState } from '@maelstrom-co/client';
import { defineVessel, SessionId } from '@maelstrom-co/protocol';

import { createMaelstrom, vessel } from '@maelstrom-co/react';
import type {
  AdapterTurnControl,
  RealtimeProviderAdapter,
} from '@maelstrom-co/realtime';
import { act, cleanup, render } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';
import { createMockConnector } from './__tests__/mock-connector.js';
import type {
  CreateAdapterContext,
  UseVoiceResult,
} from './maelstrom-realtime.js';

// Fakes the module boundary maelstrom-realtime.ts constructs against —
// RealtimeSession is never real here, so the assertions below observe this
// package's own lifecycle wiring (WeakMap reuse, refcounting, transcript
// accumulation) rather than the realtime package's internals.
class FakeRealtimeSession {
  static instances: FakeRealtimeSession[] = [];

  state: VoiceSessionState = 'idle';
  lastError: unknown = undefined;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly #stateHandlers = new Set<(s: VoiceSessionState) => void>();
  readonly #transcriptHandlers = new Set<(t: TranscriptEntry) => void>();

  constructor(readonly options: unknown) {
    FakeRealtimeSession.instances.push(this);
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.emitState('connected');
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.emitState('idle');
  }

  on(event: 'state' | 'transcript', handler: never): () => void {
    const set =
      event === 'state' ? this.#stateHandlers : this.#transcriptHandlers;
    set.add(handler);
    return () => set.delete(handler);
  }

  getAudioStreams() {
    return {};
  }

  emitState(next: VoiceSessionState): void {
    this.state = next;
    for (const handler of this.#stateHandlers) handler(next);
  }

  emitTranscript(entry: TranscriptEntry): void {
    for (const handler of this.#transcriptHandlers) handler(entry);
  }
}

mock.module('@maelstrom-co/realtime', () => ({
  RealtimeSession: FakeRealtimeSession,
}));

const { maelstromRealtime } = await import('./maelstrom-realtime.js');

const testVessel = defineVessel({
  id: 'use-voice-test-vessel',
  name: 'Use Voice Test Vessel',
  description:
    'Minimal vessel to satisfy createMaelstrom in useVoice hook tests',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [],
    },
  },
});

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected value to be defined');
  return value;
}

// Implements every required RealtimeProviderAdapter member as a typed no-op
// so tests exercising only a slice of the contract (e.g. turnControl) still
// typecheck against the real interface — adding a required method to the
// contract must fail these tests, not silently pass behind a cast.
function makeFakeAdapter(
  overrides?: Partial<RealtimeProviderAdapter>,
): RealtimeProviderAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    getAudioStreams: () => ({}),
    sendToolResult: async () => {},
    injectGrounding: () => {},
    on: () => () => {},
    ...overrides,
  };
}

function setup(
  createAdapter: (ctx: CreateAdapterContext) => RealtimeProviderAdapter = () =>
    makeFakeAdapter(),
) {
  const entry = vessel(testVessel, () => null);
  const m = createMaelstrom({ vessels: [entry] }).with(
    maelstromRealtime({ createAdapter }),
  );
  const connector = createMockConnector();
  return { m, connector };
}

beforeEach(() => {
  FakeRealtimeSession.instances = [];
});

afterEach(() => {
  cleanup();
});

describe('maelstromRealtime() useVoice lifecycle', () => {
  it('two consumers under one Provider share one session', async () => {
    const { m, connector } = setup();
    function ConsumerA() {
      m.useVoice();
      return null;
    }
    function ConsumerB() {
      m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <ConsumerA />
          <ConsumerB />
        </m.Provider>,
      );
    });

    expect(FakeRealtimeSession.instances).toHaveLength(1);
  });

  it('StrictMode double-mount creates exactly one session that remains usable', async () => {
    const { m, connector } = setup();
    let api: UseVoiceResult | undefined;
    function Consumer() {
      api = m.useVoice();
      return null;
    }

    // The Provider gates rendering behind its orchestrator state, so the
    // transient first orchestrator under StrictMode never reaches a
    // committed render and exactly one session is ever constructed. React 19
    // still genuinely double-invokes the hook's own mount/cleanup/mount for
    // its first (and only) commit, which does fire one transient
    // `disconnect()` on the fresh, not-yet-connected session — so asserting
    // `disconnectCalls === 0` here would not hold. What must hold, and does,
    // is that exactly one session is created and it remains fully usable
    // afterward.
    await act(async () => {
      render(
        <StrictMode>
          <m.Provider connector={connector}>
            <Consumer />
          </m.Provider>
        </StrictMode>,
      );
    });

    expect(FakeRealtimeSession.instances).toHaveLength(1);
    expect(api).toBeDefined();

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      await must(api).connect();
    });
    expect(session.connectCalls).toBeGreaterThan(0);
  });

  it('disconnects only when the last consumer unmounts', async () => {
    const { m, connector } = setup();
    function ConsumerA() {
      m.useVoice();
      return null;
    }
    function ConsumerB() {
      m.useVoice();
      return null;
    }

    let rerender!: (ui: ReactNode) => void;
    await act(async () => {
      ({ rerender } = render(
        <m.Provider connector={connector}>
          <ConsumerA />
          <ConsumerB />
        </m.Provider>,
      ));
    });

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

  it('propagates state changes to hook state', async () => {
    const { m, connector } = setup();
    let api: UseVoiceResult | undefined;
    function Consumer() {
      api = m.useVoice();
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
      session.emitState('speaking');
    });

    expect(must(api).state).toBe('speaking');
  });

  it('accumulates transcript fragments and replaces on final', async () => {
    const { m, connector } = setup();
    let api: UseVoiceResult | undefined;
    function Consumer() {
      api = m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    const session = must(FakeRealtimeSession.instances[0]);

    await act(async () => {
      session.emitTranscript({ role: 'assistant', text: 'On ', final: false });
    });
    expect(must(api).assistantTranscript?.text).toBe('On ');
    expect(must(api).assistantTranscript?.final).toBe(false);

    await act(async () => {
      session.emitTranscript({
        role: 'assistant',
        text: 'it — ',
        final: false,
      });
    });
    expect(must(api).assistantTranscript?.text).toBe('On it — ');
    expect(must(api).assistantTranscript?.final).toBe(false);

    await act(async () => {
      session.emitTranscript({
        role: 'assistant',
        text: 'On it — done.',
        final: true,
      });
    });
    expect(must(api).assistantTranscript?.text).toBe('On it — done.');
    expect(must(api).assistantTranscript?.final).toBe(true);

    // A fresh non-final fragment after a final starts a new accumulation
    // rather than appending onto the completed utterance.
    await act(async () => {
      session.emitTranscript({
        role: 'assistant',
        text: 'Next ',
        final: false,
      });
    });
    expect(must(api).assistantTranscript?.text).toBe('Next ');
    expect(must(api).assistantTranscript?.final).toBe(false);
  });

  it('tracks user and assistant transcripts independently', async () => {
    const { m, connector } = setup();
    let api: UseVoiceResult | undefined;
    function Consumer() {
      api = m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    const session = must(FakeRealtimeSession.instances[0]);

    await act(async () => {
      session.emitTranscript({ role: 'user', text: 'show labs', final: true });
    });
    expect(must(api).userTranscript?.text).toBe('show labs');
    expect(must(api).assistantTranscript).toBeUndefined();
  });

  it('exposes session.lastError as error when state becomes error', async () => {
    const { m, connector } = setup();
    let api: UseVoiceResult | undefined;
    function Consumer() {
      api = m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    const session = must(FakeRealtimeSession.instances[0]);
    const sentinel = new Error('boom');
    session.lastError = sentinel;

    await act(async () => {
      session.emitState('error');
    });

    expect(must(api).error).toBe(sentinel);
    expect(must(api).state).toBe('error');
  });

  it('seeds state from an already-connected session for late mounts', async () => {
    const { m, connector } = setup();
    function First() {
      m.useVoice();
      return null;
    }

    let rerender!: (ui: ReactNode) => void;
    await act(async () => {
      ({ rerender } = render(
        <m.Provider connector={connector}>
          <First />
        </m.Provider>,
      ));
    });

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      await session.connect();
    });
    expect(session.state).toBe('connected');

    let lateApi: UseVoiceResult | undefined;
    function Late() {
      lateApi = m.useVoice();
      return null;
    }

    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <First />
          <Late />
        </m.Provider>,
      );
    });

    expect(FakeRealtimeSession.instances).toHaveLength(1);
    expect(must(lateApi).state).toBe('connected');
  });

  it('exposes connect/disconnect wrappers delegating to the shared session', async () => {
    const { m, connector } = setup();
    let api: UseVoiceResult | undefined;
    function Consumer() {
      api = m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      await must(api).connect();
    });
    expect(session.connectCalls).toBe(1);

    await act(async () => {
      await must(api).disconnect();
    });
    expect(session.disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it('surfaces the adapter turnControl on the hook result', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(() => makeFakeAdapter({ turnControl }));
    let api: UseVoiceResult | undefined;
    function Consumer() {
      api = m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(must(api).turnControl).toBe(turnControl);
  });

  it('leaves turnControl undefined for speech-native adapters', async () => {
    const { m, connector } = setup();
    let api: UseVoiceResult | undefined;
    function Consumer() {
      api = m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(must(api).turnControl).toBeUndefined();
  });

  it('passes the orchestrator sessionId to createAdapter', async () => {
    const receivedContexts: CreateAdapterContext[] = [];
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] }).with(
      maelstromRealtime({
        createAdapter: (ctx) => {
          receivedContexts.push(ctx);
          return makeFakeAdapter();
        },
      }),
    );
    const connector = createMockConnector();

    function Consumer() {
      m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector} sessionId="fixed-session-id">
          <Consumer />
        </m.Provider>,
      );
    });

    expect(receivedContexts).toHaveLength(1);
    expect(must(receivedContexts[0]).sessionId).toBe(
      SessionId('fixed-session-id'),
    );
  });
});
