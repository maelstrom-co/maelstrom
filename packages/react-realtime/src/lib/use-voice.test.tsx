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

type FakeVadController = {
  state: { mode: 'idle' | 'active' | 'manual_fallback'; error?: unknown };
  destroyed: boolean;
  startCalls: number;
  pauseCalls: number;
  destroyCalls: number;
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
  emitFallback(error: unknown): void;
};

const fakeVadControllers: FakeVadController[] = [];
let vadPauseGate: Promise<void> | undefined;
let vadPauseStarted = false;
let vadPauseError: unknown;
let vadStartGate: Promise<void> | undefined;
let sessionDisconnectGate: Promise<void> | undefined;
let sessionDisconnectStarted = false;
let sessionDisconnectError: unknown;
let sessionConnectGate: Promise<void> | undefined;
let vadDestroyError: unknown;
let vadUnsubscribeError: unknown;
const reportedVadErrors: unknown[] = [];

mock.module('./browser-vad-controller.js', () => ({
  createBrowserVadController: ({
    onError,
  }: {
    onError: (error: unknown) => void;
  }) => {
    const controller: FakeVadController = {
      state: { mode: 'idle' },
      destroyed: false,
      startCalls: 0,
      pauseCalls: 0,
      destroyCalls: 0,
      async start() {
        controller.startCalls += 1;
        if (controller.destroyed) return;
        if (vadStartGate) {
          await vadStartGate;
        }
        if (controller.destroyed) return;
        controller.state = { mode: 'active' };
      },
      async pause() {
        controller.pauseCalls += 1;
        if (vadPauseError) throw vadPauseError;
        if (vadPauseGate) {
          vadPauseStarted = true;
          await vadPauseGate;
        }
        controller.state = { mode: 'idle' };
      },
      async destroy() {
        controller.destroyCalls += 1;
        controller.destroyed = true;
        if (vadDestroyError) throw vadDestroyError;
        controller.state = {
          mode: 'manual_fallback',
          error: new Error('destroyed'),
        };
      },
      emitFallback(error: unknown) {
        controller.state = { mode: 'manual_fallback', error };
        onError(error);
      },
    };
    fakeVadControllers.push(controller);
    return controller;
  },
}));

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

  get stateHandlerCount() {
    return this.#stateHandlers.size;
  }

  constructor(readonly options: unknown) {
    FakeRealtimeSession.instances.push(this);
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    if (sessionConnectGate) {
      await sessionConnectGate;
    }
    this.emitState('connected');
  }

  async disconnect(): Promise<void> {
    sessionDisconnectStarted = true;
    if (sessionDisconnectGate) await sessionDisconnectGate;
    this.disconnectCalls += 1;
    if (sessionDisconnectError) throw sessionDisconnectError;
    this.emitState('idle');
  }

  on(event: 'state' | 'transcript', handler: never): () => void {
    const set =
      event === 'state' ? this.#stateHandlers : this.#transcriptHandlers;
    set.add(handler);
    return () => {
      if (
        event === 'state' &&
        vadUnsubscribeError &&
        [...this.#stateHandlers][0] === handler
      ) {
        const error = vadUnsubscribeError;
        vadUnsubscribeError = undefined;
        throw error;
      }
      set.delete(handler);
    };
  }

  getAudioStreams() {
    const adapter = (this.options as { adapter?: RealtimeProviderAdapter })
      .adapter;
    return adapter && typeof adapter.getAudioStreams === 'function'
      ? adapter.getAudioStreams()
      : {};
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(
  createAdapter: (ctx: CreateAdapterContext) => RealtimeProviderAdapter = () =>
    makeFakeAdapter(),
  withVAD = false,
  onVadError?: (error: unknown) => void,
) {
  const entry = vessel(testVessel, () => null);
  const realtime = maelstromRealtime({ createAdapter });
  const extension = withVAD
    ? realtime.withVAD({ assetBaseUrl: '/vad-web/', onError: onVadError })
    : realtime;
  const m = createMaelstrom({ vessels: [entry] }).with(extension);
  const connector = createMockConnector();
  return { m, connector };
}

beforeEach(() => {
  FakeRealtimeSession.instances = [];
  fakeVadControllers.length = 0;
  vadPauseGate = undefined;
  vadPauseStarted = false;
  vadPauseError = undefined;
  vadStartGate = undefined;
  sessionDisconnectGate = undefined;
  sessionDisconnectStarted = false;
  sessionDisconnectError = undefined;
  sessionConnectGate = undefined;
  vadDestroyError = undefined;
  vadUnsubscribeError = undefined;
  reportedVadErrors.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('maelstromRealtime() useVoice lifecycle', () => {
  it('is structurally compatible with createMaelstrom().with after fluent VAD configuration', () => {
    const { m } = setup(() => ({}) as never, true);

    expect(m.useVoice).toBeFunction();
  });

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

  it('keeps push-to-talk manual when browser VAD is not configured', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(() => ({ turnControl }) as never);
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

    expect(must(api).turnMode).toBe('manual');
    expect(must(api).vadError).toBeUndefined();
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
    expect(must(api).turnMode).toBe('manual');
  });

  it('does not initialize VAD without adapter turnControl', async () => {
    const { m, connector } = setup(
      () => ({ getAudioStreams: () => ({ mic: {} as MediaStream }) }) as never,
      true,
    );
    function Consumer() {
      m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(fakeVadControllers).toHaveLength(0);
  });

  it('keeps manual mode until configured VAD is active', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
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

    expect(must(api).turnMode).toBe('manual');
  });

  it('starts one shared VAD controller after a connected session exposes its mic', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
    let first: UseVoiceResult | undefined;
    let second: UseVoiceResult | undefined;
    function Consumers() {
      first = m.useVoice();
      second = m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumers />
        </m.Provider>,
      );
    });
    const session = must(FakeRealtimeSession.instances[0]);

    await act(async () => {
      await session.connect();
    });

    expect(fakeVadControllers).toHaveLength(1);
    expect(must(first).turnMode).toBe('automatic');
    expect(must(second).turnMode).toBe('automatic');
  });

  it('pauses and resumes the shared VAD controller across disconnect and reconnect', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
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
    const voice = must(api);
    await act(async () => {
      await voice.connect();
      await voice.disconnect();
      await voice.connect();
    });

    const vad = must(fakeVadControllers[0]);
    expect(fakeVadControllers).toHaveLength(1);
    expect(vad.pauseCalls).toBe(1);
    expect(vad.startCalls).toBe(2);
  });

  it('keeps one VAD controller through a StrictMode remount', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
    function Consumer() {
      m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <StrictMode>
          <m.Provider connector={connector}>
            <Consumer />
          </m.Provider>
        </StrictMode>,
      );
    });

    expect(fakeVadControllers).toHaveLength(1);
  });

  it('reuses the entry when a remount happens before retirement reconciliation', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
    function Consumer() {
      m.useVoice();
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

    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      rerender(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(FakeRealtimeSession.instances).toHaveLength(1);
    expect(fakeVadControllers).toHaveLength(1);
  });

  it('creates fresh resources after retirement and ignores late old-session completion', async () => {
    const disconnect = deferred<void>();
    sessionDisconnectGate = disconnect.promise;
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
    function Consumer() {
      m.useVoice();
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
    const firstSession = must(FakeRealtimeSession.instances[0]);
    const firstVad = must(fakeVadControllers[0]);

    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      await Promise.resolve();
    });
    expect(sessionDisconnectStarted).toBe(true);
    expect(FakeRealtimeSession.instances).toHaveLength(1);

    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(FakeRealtimeSession.instances).toHaveLength(2);
    expect(fakeVadControllers).toHaveLength(2);
    const secondSession = must(FakeRealtimeSession.instances[1]);
    const secondVad = must(fakeVadControllers[1]);
    expect(secondSession).not.toBe(firstSession);
    expect(secondVad).not.toBe(firstVad);

    disconnect.resolve();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(firstVad.destroyed).toBe(true);
    expect(secondVad.destroyed).toBe(false);
  });

  it('ignores a stale VAD start completion after a replacement entry is live', async () => {
    const start = deferred<void>();
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
    function Consumer() {
      m.useVoice();
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
    const firstSession = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      await firstSession.connect();
    });
    const firstVad = must(fakeVadControllers[0]);
    firstVad.state = { mode: 'idle' };
    vadStartGate = start.promise;

    await act(async () => {
      firstSession.emitState('connected');
      await Promise.resolve();
    });
    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      await Promise.resolve();
    });
    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(FakeRealtimeSession.instances).toHaveLength(2);
    const secondSession = must(FakeRealtimeSession.instances[1]);
    const secondVad = must(fakeVadControllers[1]);
    vadStartGate = undefined;
    await act(async () => {
      await secondSession.connect();
    });
    start.resolve();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(secondVad.state.mode).toBe('active');
    expect(secondVad.destroyed).toBe(false);
  });

  it('propagates VAD failure as manual mode and keeps turnControl available', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
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
    const vadError = new Error('vad failed');
    await act(async () => {
      await session.connect();
      must(fakeVadControllers[0]).emitFallback(vadError);
    });

    expect(must(api).turnMode).toBe('manual');
    expect(must(api).vadError).toBe(vadError);
    expect(must(api).turnControl).toBe(turnControl);
  });

  it('destroys the shared VAD controller when the last consumer leaves', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
    function Consumer() {
      m.useVoice();
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
    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      await session.connect();
    });
    const vad = must(fakeVadControllers[0]);

    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(vad.state.mode).toBe('manual_fallback');
  });

  it('clears an entry after hanging cleanup so a later consumer gets a fresh session', async () => {
    const disconnect = deferred<void>();
    sessionDisconnectGate = disconnect.promise;
    vadPauseGate = new Promise<void>(() => {});
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
    function Consumer() {
      m.useVoice();
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
    const firstSession = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      await firstSession.connect();
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(sessionDisconnectStarted).toBe(true);
    expect(vadPauseStarted).toBe(true);

    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(FakeRealtimeSession.instances).toHaveLength(2);
    expect(fakeVadControllers).toHaveLength(2);
    disconnect.resolve();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(must(fakeVadControllers[1]).destroyed).toBe(false);
  });

  it('continues teardown when VAD pause, listener unsubscribe, disconnect, and destroy reject', async () => {
    vadPauseError = new Error('pause failed');
    vadUnsubscribeError = new Error('unsubscribe failed');
    sessionDisconnectError = new Error('disconnect failed');
    vadDestroyError = new Error('destroy failed');
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
      (error) => reportedVadErrors.push(error),
    );
    function Consumer() {
      m.useVoice();
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
    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      await session.connect();
    });

    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(sessionDisconnectStarted).toBe(true);
    expect(must(fakeVadControllers[0]).destroyCalls).toBe(1);
    expect(reportedVadErrors).toHaveLength(4);
  });

  it('attempts each cleanup operation exactly once', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
    function Consumer() {
      m.useVoice();
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
    const session = must(FakeRealtimeSession.instances[0]);
    const vad = must(fakeVadControllers[0]);
    await act(async () => {
      await session.connect();
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vad.pauseCalls).toBe(1);
    expect(session.disconnectCalls).toBe(1);
    expect(vad.destroyCalls).toBe(1);
  });

  it('unsubscribes the retired VAD state listener before a replacement attaches', async () => {
    const turnControl: AdapterTurnControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () =>
        ({
          turnControl,
          getAudioStreams: () => ({ mic: {} as MediaStream }),
        }) as never,
      true,
    );
    function Consumer() {
      m.useVoice();
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
    const session = must(FakeRealtimeSession.instances[0]);
    expect(session.stateHandlerCount).toBe(2);

    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(session.stateHandlerCount).toBe(0);

    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });
    expect(FakeRealtimeSession.instances).toHaveLength(2);
    expect(must(FakeRealtimeSession.instances[1]).stateHandlerCount).toBe(2);
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
