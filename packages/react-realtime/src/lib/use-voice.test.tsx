import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { TranscriptEntry, VoiceSessionState } from '@maelstrom-co/client';
import { defineVessel, SessionId } from '@maelstrom-co/protocol';
import { createMaelstrom, vessel } from '@maelstrom-co/react';
import type {
  AdapterTurnControl,
  GreetingState,
  RealtimeProviderAdapter,
  TurnModeEvent,
} from '@maelstrom-co/realtime';
import { act, cleanup, render } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';

import { createMockConnector } from './__tests__/mock-connector.js';
import type {
  CreateAdapterContext,
  MaelstromRealtimeOptions,
  UseVoiceResult,
} from './maelstrom-realtime.js';

let sessionConnectGate: Promise<void> | undefined;
let sessionDisconnectGate: Promise<void> | undefined;
const nativeQueueMicrotask = globalThis.queueMicrotask;

class FakeGreetingCoordinator {
  #terminal = false;

  getSnapshot() {
    return {
      lifecycle: this.#terminal ? ('terminal' as const) : ('pending' as const),
    };
  }

  markTerminal(): void {
    this.#terminal = true;
  }
}

class FakeRealtimeSession {
  static instances: FakeRealtimeSession[] = [];

  state: VoiceSessionState = 'idle';
  lastError: unknown;
  turnMode: 'automatic' | 'manual' = 'automatic';
  turnModeError: unknown;
  turnControl: AdapterTurnControl | undefined;
  greetingState: GreetingState;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly options: {
    greeting?: { text: string; coordinator: unknown };
  };
  readonly #stateHandlers = new Set<(state: VoiceSessionState) => void>();
  readonly #transcriptHandlers = new Set<(entry: TranscriptEntry) => void>();
  readonly #turnModeHandlers = new Set<(event: TurnModeEvent) => void>();
  readonly #greetingStateHandlers = new Set<
    (state: FakeRealtimeSession['greetingState']) => void
  >();

  constructor(options: { greeting?: { text: string; coordinator: unknown } }) {
    this.options = options;
    const coordinator = options.greeting?.coordinator as
      | FakeGreetingCoordinator
      | undefined;
    this.greetingState = options.greeting
      ? coordinator?.getSnapshot().lifecycle === 'terminal'
        ? 'settled'
        : 'pending'
      : 'not_configured';
    FakeRealtimeSession.instances.push(this);
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    if (sessionConnectGate) await sessionConnectGate;
    this.emitState('connected');
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    if (sessionDisconnectGate) await sessionDisconnectGate;
    this.turnControl = undefined;
    this.emitState('idle');
  }

  on(
    event: 'state' | 'transcript' | 'turn_mode' | 'greeting_state',
    handler: ((state: VoiceSessionState) => void) &
      ((entry: TranscriptEntry) => void) &
      ((event: TurnModeEvent) => void),
  ): () => void {
    const handlers =
      event === 'state'
        ? this.#stateHandlers
        : event === 'transcript'
          ? this.#transcriptHandlers
          : event === 'turn_mode'
            ? this.#turnModeHandlers
            : this.#greetingStateHandlers;
    handlers.add(handler as never);
    return () => handlers.delete(handler as never);
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

  emitGreetingState(state: FakeRealtimeSession['greetingState']): void {
    this.greetingState = state;
    if (state === 'settled') {
      (
        this.options.greeting?.coordinator as
          | FakeGreetingCoordinator
          | undefined
      )?.markTerminal();
    }
    for (const handler of this.#greetingStateHandlers) handler(state);
  }
}

mock.module('@maelstrom-co/realtime', () => ({
  RealtimeSession: FakeRealtimeSession,
  GreetingCoordinator: FakeGreetingCoordinator,
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
  createAdapter?:
    | ((context: CreateAdapterContext) => RealtimeProviderAdapter)
    | {
        createAdapter?: (
          context: CreateAdapterContext,
        ) => RealtimeProviderAdapter;
        onEvent?: (event: unknown) => void;
        greeting?: MaelstromRealtimeOptions['greeting'];
      },
  onEvent?: (event: unknown) => void,
) {
  const defaultAdapter = () => makeFakeAdapter();
  const opts =
    createAdapter === undefined
      ? { createAdapter: defaultAdapter, onEvent, greeting: undefined }
      : typeof createAdapter === 'function'
        ? { createAdapter, onEvent, greeting: undefined }
        : {
            createAdapter: createAdapter.createAdapter ?? defaultAdapter,
            onEvent: createAdapter.onEvent ?? onEvent,
            greeting: createAdapter.greeting,
          };
  const entry = vessel(testVessel, () => null);
  const m = createMaelstrom({ vessels: [entry] }).with(
    maelstromRealtime({
      createAdapter: opts.createAdapter,
      onEvent: opts.onEvent as never,
      greeting: opts.greeting,
    }),
  );
  return { m, connector: createMockConnector() };
}

beforeEach(() => {
  FakeRealtimeSession.instances = [];
  sessionConnectGate = undefined;
  sessionDisconnectGate = undefined;
  globalThis.queueMicrotask = nativeQueueMicrotask;
});

afterEach(() => {
  globalThis.queueMicrotask = nativeQueueMicrotask;
  cleanup();
});

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

  it('cancels queued retirement when a consumer remounts first', async () => {
    const { m, connector } = setup();
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
    const queuedMicrotasks: VoidFunction[] = [];
    // Hold the retirement boundary until the replacement consumer is live.
    globalThis.queueMicrotask = (callback) => queuedMicrotasks.push(callback);

    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
    });
    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <Consumer />
        </m.Provider>,
      );
    });

    expect(queuedMicrotasks.length).toBeGreaterThan(0);
    expect(FakeRealtimeSession.instances).toEqual([session]);

    globalThis.queueMicrotask = nativeQueueMicrotask;
    await act(async () => {
      for (const callback of queuedMicrotasks) callback();
    });

    expect(FakeRealtimeSession.instances).toEqual([session]);
    expect(session.disconnectCalls).toBe(0);
  });

  it('replaces a retired session before its delayed disconnect can update the winner', async () => {
    const disconnect = deferred<void>();
    sessionDisconnectGate = disconnect.promise;
    const { m, connector } = setup();
    let replacementVoice: UseVoiceResult | undefined;
    function First() {
      m.useVoice();
      return null;
    }
    function Replacement() {
      replacementVoice = m.useVoice();
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
    const retired = must(FakeRealtimeSession.instances[0]);
    const queuedMicrotasks: VoidFunction[] = [];
    // Commit retirement before mounting a winner, but keep old teardown pending.
    globalThis.queueMicrotask = (callback) => queuedMicrotasks.push(callback);
    await act(async () => {
      rerender(<m.Provider connector={connector}>{null}</m.Provider>);
    });

    expect(queuedMicrotasks.length).toBeGreaterThan(0);
    globalThis.queueMicrotask = nativeQueueMicrotask;
    await act(async () => {
      for (const callback of queuedMicrotasks) callback();
    });
    expect(retired.disconnectCalls).toBe(1);

    await act(async () => {
      rerender(
        <m.Provider connector={connector}>
          <Replacement />
        </m.Provider>,
      );
    });
    const replacement = must(FakeRealtimeSession.instances[1]);
    expect(FakeRealtimeSession.instances).toHaveLength(2);
    await act(async () => replacement.emitState('speaking'));

    disconnect.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    expect(retired.state).toBe('idle');
    expect(must(replacementVoice).session as unknown).toBe(replacement);
    expect(must(replacementVoice).state).toBe('speaking');
    expect(replacement.disconnectCalls).toBe(0);
  });

  it('concatenates assistant transcript partials', async () => {
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
      session.emitTranscript({ role: 'assistant', text: 'On ', final: false });
      session.emitTranscript({ role: 'assistant', text: 'it', final: false });
    });

    expect(must(voice).assistantTranscript).toEqual({
      role: 'assistant',
      text: 'On it',
      final: false,
    });
  });

  it('replaces assistant partials with the final transcript', async () => {
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
      session.emitTranscript({ role: 'assistant', text: 'On ', final: false });
      session.emitTranscript({
        role: 'assistant',
        text: 'On it.',
        final: true,
      });
    });

    expect(must(voice).assistantTranscript).toEqual({
      role: 'assistant',
      text: 'On it.',
      final: true,
    });
  });

  it('starts a new assistant transcript after a final transcript', async () => {
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
      session.emitTranscript({ role: 'assistant', text: 'Done.', final: true });
      session.emitTranscript({
        role: 'assistant',
        text: 'Next ',
        final: false,
      });
      session.emitTranscript({ role: 'assistant', text: 'step', final: false });
    });

    expect(must(voice).assistantTranscript).toEqual({
      role: 'assistant',
      text: 'Next step',
      final: false,
    });
  });

  it('accumulates user and assistant transcripts independently', async () => {
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
      session.emitTranscript({ role: 'user', text: 'Show ', final: false });
      session.emitTranscript({
        role: 'assistant',
        text: 'Opening ',
        final: false,
      });
      session.emitTranscript({ role: 'user', text: 'weather', final: false });
      session.emitTranscript({ role: 'assistant', text: 'it', final: false });
    });

    expect(must(voice).userTranscript?.text).toBe('Show weather');
    expect(must(voice).assistantTranscript?.text).toBe('Opening it');
  });

  it('initializes a late-mounted consumer from retained session state', async () => {
    const { m, connector } = setup();
    let first: UseVoiceResult | undefined;
    let late: UseVoiceResult | undefined;
    function First() {
      first = m.useVoice();
      return null;
    }
    function Late() {
      late = m.useVoice();
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
    const turnModeError = new Error('automatic turns unavailable');
    const control = { startTurn: async () => {}, endTurn: async () => {} };
    await act(async () => {
      session.emitState('speaking');
      session.emitTurnMode('manual', {
        error: turnModeError,
        turnControl: control,
      });
      rerender(
        <m.Provider connector={connector}>
          <First />
          <Late />
        </m.Provider>,
      );
    });

    expect(must(first).state).toBe('speaking');
    expect(must(late).state).toBe('speaking');
    expect(must(late).turnMode).toBe('manual');
    expect(must(late).turnModeError).toBe(turnModeError);
    expect(must(late).turnControl).toBe(control);
  });

  it('exposes a fatal session error emitted after mount', async () => {
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
    const fatalError = new Error('transport failed');
    await act(async () => {
      must(FakeRealtimeSession.instances[0]).emitFatalError(fatalError);
    });

    expect(must(voice).state).toBe('error');
    expect(must(voice).error).toBe(fatalError);
    expect(must(voice).turnModeError).toBeUndefined();
  });

  it('initializes a late-mounted consumer from an errored session', async () => {
    const { m, connector } = setup();
    let late: UseVoiceResult | undefined;
    function First() {
      m.useVoice();
      return null;
    }
    function Late() {
      late = m.useVoice();
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
    const fatalError = new Error('transport failed before mount');
    await act(async () => {
      must(FakeRealtimeSession.instances[0]).emitFatalError(fatalError);
      rerender(
        <m.Provider connector={connector}>
          <First />
          <Late />
        </m.Provider>,
      );
    });

    expect(must(late).state).toBe('error');
    expect(must(late).error).toBe(fatalError);
    expect(must(late).turnModeError).toBeUndefined();
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

describe('maelstromRealtime() greeting option', () => {
  it('propagates one retained greeting lifecycle to simultaneous and late consumers', async () => {
    const { m, connector } = setup({ greeting: { text: 'Welcome.' } });
    const observed: UseVoiceResult[] = [];
    function Consumer() {
      observed.push(m.useVoice());
      return null;
    }
    const { rerender } = render(
      <m.Provider connector={connector}>
        <Consumer />
        <Consumer />
      </m.Provider>,
    );
    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => session.emitGreetingState('preparing'));
    rerender(
      <m.Provider connector={connector}>
        <Consumer />
        <Consumer />
        <Consumer />
      </m.Provider>,
    );

    expect(observed.slice(-3).map((voice) => voice.greetingState)).toEqual([
      'preparing',
      'preparing',
      'preparing',
    ]);
  });

  it('preserves synchronous terminal state across zero-consumer retirement and recreation', async () => {
    const { m, connector } = setup({ greeting: { text: 'Welcome.' } });
    let voice: UseVoiceResult | undefined;
    function Consumer() {
      voice = m.useVoice();
      return null;
    }
    const { rerender } = render(
      <m.Provider connector={connector}>
        <Consumer />
      </m.Provider>,
    );
    await act(async () => {
      must(FakeRealtimeSession.instances[0]).emitGreetingState('settled');
    });
    rerender(<m.Provider connector={connector}>{null}</m.Provider>);
    await act(async () => Promise.resolve());
    rerender(
      <m.Provider connector={connector}>
        <Consumer />
      </m.Provider>,
    );

    expect(must(voice).greetingState).toBe('settled');
  });

  it('passes greeting text and a coordinator into RealtimeSession options', async () => {
    const { m, connector } = setup({ greeting: { text: 'Welcome aboard.' } });
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

    const session = must(FakeRealtimeSession.instances[0]);
    expect(session.options.greeting?.text).toBe('Welcome aboard.');
    expect(session.options.greeting?.coordinator).toBeInstanceOf(
      FakeGreetingCoordinator,
    );
  });

  it('reuses the same coordinator across session recreation under one orchestrator', async () => {
    const { m, connector } = setup({ greeting: { text: 'Hello again.' } });
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
    const first = must(FakeRealtimeSession.instances[0]);
    const firstCoordinator = first.options.greeting?.coordinator;
    expect(firstCoordinator).toBeDefined();

    // Drop all consumers so retirement can evict the session entry, then
    // remount under the same Provider/orchestrator.
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

    const second = must(FakeRealtimeSession.instances.at(-1));
    expect(FakeRealtimeSession.instances.length).toBeGreaterThan(1);
    expect(second.options.greeting?.coordinator).toBe(firstCoordinator);
  });

  it('creates a distinct coordinator for a fresh orchestrator/session', async () => {
    const { m, connector } = setup({ greeting: { text: 'Hi there.' } });
    function Consumer() {
      m.useVoice();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider key="a" connector={connector} sessionId="session-a">
          <Consumer />
        </m.Provider>,
      );
    });
    const firstCoordinator = must(FakeRealtimeSession.instances[0]).options
      .greeting?.coordinator;

    cleanup();
    FakeRealtimeSession.instances = [];

    await act(async () => {
      render(
        <m.Provider key="b" connector={connector} sessionId="session-b">
          <Consumer />
        </m.Provider>,
      );
    });
    const secondCoordinator = must(FakeRealtimeSession.instances[0]).options
      .greeting?.coordinator;

    expect(firstCoordinator).toBeDefined();
    expect(secondCoordinator).toBeDefined();
    expect(secondCoordinator).not.toBe(firstCoordinator);
  });

  it('omits greeting from session options when not configured', async () => {
    const { m, connector } = setup();
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

    expect(
      must(FakeRealtimeSession.instances[0]).options.greeting,
    ).toBeUndefined();
  });
});
