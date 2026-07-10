import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

import { createMaelstrom, vessel } from '@maelstrom-co/react';
import { defineVessel } from '@maelstrom-co/protocol';
import type { TranscriptEntry, VoiceSessionState } from '@maelstrom-co/client';
import { createMockConnector } from './__tests__/mock-connector.js';

// Same fake as use-voice.test.tsx (Task 9) — the module boundary
// maelstrom-realtime.ts constructs against is faked here too, so these
// assertions observe VoiceOrb's own click/state/aria wiring rather than the
// realtime package's internals.
class FakeRealtimeSession {
  static instances: FakeRealtimeSession[] = [];

  state: VoiceSessionState = 'idle';
  lastError: unknown = undefined;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly #stateHandlers = new Set<(s: VoiceSessionState) => void>();
  readonly #transcriptHandlers = new Set<(t: TranscriptEntry) => void>();
  #resolveConnect: (() => void) | undefined;

  constructor(readonly options: unknown) {
    FakeRealtimeSession.instances.push(this);
  }

  // Mirrors the real RealtimeSession.connect() shape: emits 'connecting'
  // synchronously, then parks on the in-flight handshake until the test
  // calls resolveConnect() — needed to exercise the click-while-connecting
  // race a synchronous fake can't otherwise reproduce.
  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.emitState('connecting');
    await new Promise<void>((resolve) => {
      this.#resolveConnect = resolve;
    });
    this.emitState('connected');
  }

  resolveConnect(): void {
    this.#resolveConnect?.();
    this.#resolveConnect = undefined;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.emitState('idle');
  }

  on(event: 'state' | 'transcript', handler: never): () => void {
    const set = event === 'state' ? this.#stateHandlers : this.#transcriptHandlers;
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
  id: 'voice-orb-test-vessel',
  name: 'Voice Orb Test Vessel',
  description: 'Minimal vessel to satisfy createMaelstrom in VoiceOrb tests',
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

// happy-dom's querySelector/getByRole path throws in this package's minimal,
// non-globally-registered Window setup (see setup.ts) — a pre-existing
// limitation unrelated to VoiceOrb. VoiceOrb renders a single <button> as
// its root, so container.firstChild reaches it without going through the
// broken selector engine.
function getButton(container: HTMLElement): HTMLButtonElement {
  const button = must(container.firstChild as HTMLButtonElement | null | undefined);
  expect(button.tagName).toBe('BUTTON');
  return button;
}

function setup() {
  const entry = vessel(testVessel, () => null);
  const m = createMaelstrom({ vessels: [entry] }).with(
    maelstromRealtime({ createAdapter: () => ({}) as never }),
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

describe('VoiceOrb', () => {
  it('renders a button with data-state and starts voice on click from idle', async () => {
    const { m, connector } = setup();

    const { container } = await act(async () => {
      return render(
        <m.Provider connector={connector}>
          <m.VoiceOrb />
        </m.Provider>,
      );
    });

    const button = getButton(container);
    expect(button.dataset.state).toBe('idle');
    expect(button.getAttribute('aria-label')).toBe('Start voice');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(must(FakeRealtimeSession.instances[0]).connectCalls).toBe(1);
  });

  it('disables the button and ignores a second click while connecting, avoiding the disconnect race', async () => {
    const { m, connector } = setup();

    const { container } = await act(async () => {
      return render(
        <m.Provider connector={connector}>
          <m.VoiceOrb />
        </m.Provider>,
      );
    });

    const button = getButton(container);

    await act(async () => {
      fireEvent.click(button);
    });

    const session = must(FakeRealtimeSession.instances[0]);
    expect(session.state).toBe('connecting');
    expect(button.dataset.state).toBe('connecting');

    await act(async () => {
      fireEvent.click(button);
    });

    // RealtimeSession.disconnect() has no re-entry guard against an
    // in-flight connect() — calling it mid-handshake can silently resurrect
    // the session once the handshake resolves. The button must not let a
    // click reach disconnect() while connecting.
    expect(session.disconnectCalls).toBe(0);
    expect(button.disabled).toBe(true);
  });

  it('stops voice on click while connected', async () => {
    const { m, connector } = setup();

    const { container } = await act(async () => {
      return render(
        <m.Provider connector={connector}>
          <m.VoiceOrb />
        </m.Provider>,
      );
    });

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('connected');
    });

    const button = getButton(container);
    expect(button.getAttribute('aria-label')).toBe('Stop voice');
    await act(async () => {
      fireEvent.click(button);
    });

    expect(session.disconnectCalls).toBe(1);
  });

  it('reflects live state on data-state', async () => {
    const { m, connector } = setup();

    const { container } = await act(async () => {
      return render(
        <m.Provider connector={connector}>
          <m.VoiceOrb />
        </m.Provider>,
      );
    });

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('speaking');
    });

    const button = getButton(container);
    expect(button.dataset.state).toBe('speaking');
    expect(button.getAttribute('aria-label')).toBe('Stop voice');
  });

  it('retries connect on click from error state', async () => {
    const { m, connector } = setup();

    const { container } = await act(async () => {
      return render(
        <m.Provider connector={connector}>
          <m.VoiceOrb />
        </m.Provider>,
      );
    });

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('error');
    });

    const button = getButton(container);
    expect(button.dataset.state).toBe('error');
    expect(button.getAttribute('aria-label')).toBe('Start voice');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(session.connectCalls).toBe(1);
  });
});
