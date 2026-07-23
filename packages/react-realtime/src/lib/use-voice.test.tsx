import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { TranscriptEntry, VoiceSessionState } from '@maelstrom-co/client';
import { defineVessel, SessionId } from '@maelstrom-co/protocol';
import { createMaelstrom, vessel } from '@maelstrom-co/react';
import type {
  AdapterTurnControl,
  RealtimeProviderAdapter,
  TurnModeEvent,
} from '@maelstrom-co/realtime';
import { act, cleanup, render } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';

import { createMockConnector } from './__tests__/mock-connector.js';
import type {
  CreateAdapterContext,
  UseVoiceResult,
} from './maelstrom-realtime.js';

let sessionConnectGate: Promise<void> | undefined;

class FakeRealtimeSession {
  static instances: FakeRealtimeSession[] = [];

  state: VoiceSessionState = 'idle';
  lastError: unknown;
  turnMode: 'automatic' | 'manual' = 'automatic';
  turnModeError: unknown;
  turnControl: AdapterTurnControl | undefined;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly #stateHandlers = new Set<(state: VoiceSessionState) => void>();
  readonly #transcriptHandlers = new Set<(entry: TranscriptEntry) => void>();
  readonly #turnModeHandlers = new Set<(event: TurnModeEvent) => void>();

  constructor(readonly options: unknown) {
    FakeRealtimeSession.instances.push(this);
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    if (sessionConnectGate) await sessionConnectGate;
    this.emitState('connected');
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.turnControl = undefined;
    this.emitState('idle');
  }

  on(
    event: 'state' | 'transcript' | 'turn_mode',
    handler: ((state: VoiceSessionState) => void) &
      ((entry: TranscriptEntry) => void) &
      ((event: TurnModeEvent) => void),
  ): () => void {
    const handlers =
      event === 'state'
        ? this.#stateHandlers
        : event === 'transcript'
          ? this.#transcriptHandlers
          : this.#turnModeHandlers;
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  getAudioStreams() {
    return {};
  }

  emitState(state: VoiceSessionState): void {
    this.state = state;
    for (const handler of this.#stateHandlers) handler(state);
  }

  emitFatalError(error: unknown): void {
    this.turnControl = undefined;
    this.lastError = error;
    this.emitState('error');
  }

  emitTranscript(entry: TranscriptEntry): void {
    for (const handler of this.#transcriptHandlers) handler(entry);
  }

  emitTurnMode(
    mode: 'automatic' | 'manual',
    options: { error?: unknown; turnControl?: AdapterTurnControl } = {},
  ): void {
    this.turnMode = mode;
    this.turnModeError = options.error;
    this.turnControl = mode === 'manual' ? options.turnControl : undefined;
    const event: TurnModeEvent =
      options.error === undefined
        ? { type: 'turn_mode', mode }
        : { type: 'turn_mode', mode, error: options.error };
    for (const handler of this.#turnModeHandlers) handler(event);
  }
}

mock.module('@maelstrom-co/realtime', () => ({
  RealtimeSession: FakeRealtimeSession,
}));

const { maelstromRealtime } = await import('./maelstrom-realtime.js');

const testVessel = defineVessel({
  id: 'use-voice-test-vessel',
  name: 'Use Voice Test Vessel',
  description: 'Minimal vessel for useVoice hook tests',
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
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup(
  createAdapter: (
    context: CreateAdapterContext,
  ) => RealtimeProviderAdapter = () => makeFakeAdapter(),
  onEvent?: (event: unknown) => void,
) {
  const entry = vessel(testVessel, () => null);
  const m = createMaelstrom({ vessels: [entry] }).with(
    maelstromRealtime({ createAdapter, onEvent: onEvent as never }),
  );
  return { m, connector: createMockConnector() };
}

beforeEach(() => {
  FakeRealtimeSession.instances = [];
  sessionConnectGate = undefined;
});

afterEach(() => cleanup());

describe('maelstromRealtime() useVoice lifecycle', () => {
  it('shares one session between consumers under one Provider', async () => {
    const { m, connector } = setup();
    function Consumer() {
      m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
          <Consumer />
        </m.Provider>,
      );
    });

    expect(FakeRealtimeSession.instances).toHaveLength(1);
  });

  it('keeps the shared session usable through a StrictMode remount', async () => {
    const { m, connector } = setup();
    let voice: UseVoiceResult | undefined;
    function Consumer() {
      voice = m.useVoice();
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
    await act(async () => must(voice).connect());

    expect(FakeRealtimeSession.instances).toHaveLength(1);
    expect(must(FakeRealtimeSession.instances[0]).connectCalls).toBe(1);
  });

  it('disconnects only after the last consumer unmounts', async () => {
    const { m, connector } = setup();
    function First() {
      m.useVoice();
      return null;
    }
    function Second() {
      m.useVoice();
      return null;
    }
    let rerender!: (ui: ReactNode) => void;

    await act(async () => {
      ({ rerender } = render(
        <m.Provider connector={connector}>
          <First />
          <Second />
        </m.Provider>,
      ));
    });
    const session = must(FakeRealtimeSession.instances[0]);

    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <Second />
        </m.Provider>,
      );
    });
    expect(session.disconnectCalls).toBe(0);

    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      await Promise.resolve();
    });
    expect(session.disconnectCalls).toBe(1);
  });

  it('creates a fresh session when the prior consumer retires during connect', async () => {
    const connect = deferred<void>();
    sessionConnectGate = connect.promise;
    const { m, connector } = setup();
    let firstVoice: UseVoiceResult | undefined;
    function First() {
      firstVoice = m.useVoice();
      return null;
    }
    function Replacement() {
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
    const connecting = must(firstVoice).connect();
    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
      await Promise.resolve();
    });
    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <Replacement />
        </m.Provider>,
      );
    });

    expect(FakeRealtimeSession.instances).toHaveLength(2);
    connect.resolve();
    await act(async () => connecting);
    expect(FakeRealtimeSession.instances).toHaveLength(2);
  });

  it('propagates state and transcript updates', async () => {
    const { m, connector } = setup();
    let voice: UseVoiceResult | undefined;
    function Consumer() {
      voice = m.useVoice();
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
      session.emitState('speaking');
      session.emitTranscript({ role: 'assistant', text: 'On ', final: false });
      session.emitTranscript({ role: 'assistant', text: 'it', final: false });
    });

    expect(must(voice).state).toBe('speaking');
    expect(must(voice).assistantTranscript?.text).toBe('On it');
  });

  it('passes the orchestrator sessionId to createAdapter', async () => {
    const contexts: CreateAdapterContext[] = [];
    const { m, connector } = setup((context) => {
      contexts.push(context);
      return makeFakeAdapter();
    });
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

    expect(contexts).toEqual([{ sessionId: SessionId('fixed-session-id') }]);
  });
});

describe('session-owned turn mode', () => {
  it('updates every consumer from one turn_mode event', async () => {
    const { m, connector } = setup();
    let first: UseVoiceResult | undefined;
    let second: UseVoiceResult | undefined;
    function First() {
      first = m.useVoice();
      return null;
    }
    function Second() {
      second = m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <First />
          <Second />
        </m.Provider>,
      );
    });
    const control = { startTurn: async () => {}, endTurn: async () => {} };
    await act(async () => {
      must(FakeRealtimeSession.instances[0]).emitTurnMode('manual', {
        turnControl: control,
      });
    });

    expect(must(first).turnMode).toBe('manual');
    expect(must(second).turnMode).toBe('manual');
    expect(must(first).turnControl).toBe(control);
    expect(must(second).turnControl).toBe(control);
  });

  it('does not expose manual control in automatic mode', async () => {
    const adapterControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const { m, connector } = setup(
      () => ({ turnControl: adapterControl }) as never,
    );
    let voice: UseVoiceResult | undefined;
    function Consumer() {
      voice = m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(must(voice).turnMode).toBe('automatic');
    expect(must(voice).turnControl).toBeUndefined();
  });

  it('exposes degraded manual mode and its diagnostic after the event', async () => {
    const { m, connector } = setup();
    let voice: UseVoiceResult | undefined;
    function Consumer() {
      voice = m.useVoice();
      return null;
    }
    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });
    const error = new Error('automatic turns unavailable');
    const control = { startTurn: async () => {}, endTurn: async () => {} };

    await act(async () => {
      must(FakeRealtimeSession.instances[0]).emitTurnMode('manual', {
        error,
        turnControl: control,
      });
    });

    expect(must(voice).turnMode).toBe('manual');
    expect(must(voice).turnModeError).toBe(error);
    expect(must(voice).turnControl).toBe(control);
  });

  it('exposes intentional manual mode without an error', async () => {
    const { m, connector } = setup();
    let voice: UseVoiceResult | undefined;
    function Consumer() {
      voice = m.useVoice();
      return null;
    }
    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    await act(async () => {
      must(FakeRealtimeSession.instances[0]).emitTurnMode('manual', {
        turnControl: { startTurn: async () => {}, endTurn: async () => {} },
      });
    });

    expect(must(voice).turnMode).toBe('manual');
    expect(must(voice).turnModeError).toBeUndefined();
  });

  it('clears a degradation diagnostic when automatic mode is restored', async () => {
    const { m, connector } = setup();
    let voice: UseVoiceResult | undefined;
    function Consumer() {
      voice = m.useVoice();
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
      session.emitTurnMode('manual', {
        error: new Error('degraded'),
        turnControl: { startTurn: async () => {}, endTurn: async () => {} },
      });
      session.emitTurnMode('automatic');
    });

    expect(must(voice).turnMode).toBe('automatic');
    expect(must(voice).turnModeError).toBeUndefined();
    expect(must(voice).turnControl).toBeUndefined();
  });

  it('reads replacement manual controls dynamically', async () => {
    const { m, connector } = setup();
    let voice: UseVoiceResult | undefined;
    function Consumer() {
      voice = m.useVoice();
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
    const first = { startTurn: async () => {}, endTurn: async () => {} };
    const replacement = { startTurn: async () => {}, endTurn: async () => {} };
    await act(async () =>
      session.emitTurnMode('manual', { turnControl: first }),
    );
    expect(must(voice).turnControl).toBe(first);

    await act(async () =>
      session.emitTurnMode('manual', { turnControl: replacement }),
    );
    expect(must(voice).turnControl).toBe(replacement);
  });

  it('removes manual control from every consumer on disconnect without changing retained turn mode', async () => {
    const { m, connector } = setup();
    let first: UseVoiceResult | undefined;
    let second: UseVoiceResult | undefined;
    function First() {
      first = m.useVoice();
      return null;
    }
    function Second() {
      second = m.useVoice();
      return null;
    }
    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <First />
          <Second />
        </m.Provider>,
      );
    });
    const session = must(FakeRealtimeSession.instances[0]);
    const error = new Error('degraded');
    const control = { startTurn: async () => {}, endTurn: async () => {} };
    await act(async () => {
      session.emitTurnMode('manual', { error, turnControl: control });
    });

    await act(async () => must(first).disconnect());

    for (const voice of [must(first), must(second)]) {
      expect(voice.state).toBe('idle');
      expect(voice.turnMode).toBe('manual');
      expect(voice.turnModeError).toBe(error);
      expect(voice.turnControl).toBeUndefined();
    }
  });

  it('removes manual control from every consumer on fatal teardown while preserving mode diagnostics', async () => {
    const { m, connector } = setup();
    let first: UseVoiceResult | undefined;
    let second: UseVoiceResult | undefined;
    function First() {
      first = m.useVoice();
      return null;
    }
    function Second() {
      second = m.useVoice();
      return null;
    }
    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <First />
          <Second />
        </m.Provider>,
      );
    });
    const session = must(FakeRealtimeSession.instances[0]);
    const turnModeError = new Error('degraded');
    const fatalError = new Error('transport failed');
    const control = { startTurn: async () => {}, endTurn: async () => {} };
    await act(async () => {
      session.emitTurnMode('manual', {
        error: turnModeError,
        turnControl: control,
      });
    });

    await act(async () => session.emitFatalError(fatalError));

    for (const voice of [must(first), must(second)]) {
      expect(voice.state).toBe('error');
      expect(voice.error).toBe(fatalError);
      expect(voice.turnMode).toBe('manual');
      expect(voice.turnModeError).toBe(turnModeError);
      expect(voice.turnControl).toBeUndefined();
    }
  });

  it('does not mirror turn-mode diagnostics to the sidechannel', async () => {
    const sidechannelEvents: unknown[] = [];
    const { m, connector } = setup(undefined, (event) =>
      sidechannelEvents.push(event),
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

    await act(async () => {
      must(FakeRealtimeSession.instances[0]).emitTurnMode('manual', {
        error: new Error('private diagnostic'),
      });
    });

    expect(sidechannelEvents).toEqual([]);
  });
});
