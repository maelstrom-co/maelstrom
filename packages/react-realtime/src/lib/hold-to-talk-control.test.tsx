import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { VoiceSessionState } from '@maelstrom-co/client';
import { defineVessel } from '@maelstrom-co/protocol';
import { createMaelstrom, vessel } from '@maelstrom-co/react';
import {
  type AdapterTurnControl,
  RealtimeSessionMemory,
  type TurnModeEvent,
} from '@maelstrom-co/realtime';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

import { createMockConnector } from './__tests__/mock-connector.js';

class FakeRealtimeSession {
  static instances: FakeRealtimeSession[] = [];

  state: VoiceSessionState = 'idle';
  lastError: unknown = undefined;
  turnMode: 'automatic' | 'manual' = 'automatic';
  turnModeError: unknown = undefined;
  turnControl: AdapterTurnControl | undefined = undefined;
  readonly #stateHandlers = new Set<(s: VoiceSessionState) => void>();
  readonly #turnModeHandlers = new Set<(event: TurnModeEvent) => void>();

  constructor(readonly options: unknown) {
    FakeRealtimeSession.instances.push(this);
  }

  async connect(): Promise<void> {
    this.emitState('connected');
  }

  async disconnect(): Promise<void> {
    this.turnControl = undefined;
    this.emitState('idle');
  }

  on(
    event: 'state' | 'transcript' | 'turn_mode' | 'greeting_state',
    handler: never,
  ): () => void {
    if (event === 'state') {
      this.#stateHandlers.add(handler);
      return () => this.#stateHandlers.delete(handler);
    }
    if (event === 'turn_mode') {
      this.#turnModeHandlers.add(handler);
      return () => this.#turnModeHandlers.delete(handler);
    }
    return () => {};
  }

  getAudioStreams() {
    return {};
  }

  emitState(next: VoiceSessionState): void {
    this.state = next;
    for (const handler of this.#stateHandlers) handler(next);
  }

  emitTurnMode(
    mode: 'automatic' | 'manual',
    turnControl: AdapterTurnControl | undefined,
    error?: unknown,
  ): void {
    this.turnMode = mode;
    this.turnControl =
      mode === 'manual' || turnControl?.setTurnMode !== undefined
        ? turnControl
        : undefined;
    this.turnModeError = error;
    for (const handler of this.#turnModeHandlers)
      handler({
        type: 'turn_mode',
        mode,
        ...(error !== undefined ? { error } : {}),
      });
  }
}

mock.module('@maelstrom-co/realtime', () => ({
  RealtimeSessionMemory,
  RealtimeSession: FakeRealtimeSession,
  GreetingCoordinator: class FakeGreetingCoordinator {},
  attachRealtimeDiagnostics: () => () => {},
}));

const { maelstromRealtime } = await import('./maelstrom-realtime.js');

const testVessel = defineVessel({
  id: 'hold-to-talk-test-vessel',
  name: 'Hold To Talk Test Vessel',
  description:
    'Minimal vessel to satisfy createMaelstrom in HoldToTalkControl tests',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [],
    },
  },
});

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}

function makeTurnControl() {
  const control = {
    startCalls: 0,
    endCalls: 0,
    startTurn: async () => {
      control.startCalls += 1;
    },
    endTurn: async () => {
      control.endCalls += 1;
    },
  };
  return control;
}

function findButton(container: HTMLElement): HTMLButtonElement | undefined {
  for (const child of Array.from(container.children)) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement;
  }
  return undefined;
}

function setup() {
  const entry = vessel(testVessel, () => null);
  const m = createMaelstrom({ vessels: [entry] }).with(
    maelstromRealtime({
      providers: ['live', 'realtime'] as const,
      initialProvider: 'live',
      createAdapter: () => ({}) as never,
    }),
  );
  const connector = createMockConnector();
  return { m, connector };
}

async function renderManualControl() {
  const { m, connector } = setup();
  const turnControl = makeTurnControl();
  const { container } = await act(async () =>
    render(
      <m.Provider connector={connector}>
        <m.HoldToTalkControl />
      </m.Provider>,
    ),
  );
  const session = must(FakeRealtimeSession.instances[0]);
  await act(async () => {
    session.emitState('connected');
    session.emitTurnMode('manual', turnControl);
  });
  return { button: must(findButton(container)), turnControl };
}

beforeEach(() => {
  FakeRealtimeSession.instances = [];
});

afterEach(() => {
  cleanup();
});

describe('HoldToTalkControl', () => {
  it('renders nothing in automatic mode or when turnControl is absent', async () => {
    const { m, connector } = setup();
    const { container } = await act(async () =>
      render(
        <m.Provider connector={connector}>
          <m.HoldToTalkControl />
        </m.Provider>,
      ),
    );
    expect(container.children.length).toBe(0);

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('connected');
      session.emitTurnMode('automatic', makeTurnControl());
    });
    expect(container.children.length).toBe(0);

    await act(async () => {
      session.emitTurnMode('manual', undefined);
    });
    expect(container.children.length).toBe(0);
  });

  it('hides in automatic mode even while a switchable turnControl stays present', async () => {
    const { m, connector } = setup();
    const turnControl = {
      ...makeTurnControl(),
      setTurnMode: async () => {},
    };
    const { container } = await act(async () =>
      render(
        <m.Provider connector={connector}>
          <m.HoldToTalkControl />
        </m.Provider>,
      ),
    );
    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('connected');
      session.emitTurnMode('automatic', turnControl);
    });
    expect(session.turnControl).toBe(turnControl);
    expect(container.querySelector('button')).toBeNull();

    await act(async () => {
      session.emitTurnMode('manual', turnControl);
    });
    expect(container.querySelector('button')).not.toBeNull();

    await act(async () => {
      session.emitTurnMode('automatic', turnControl);
    });
    expect(container.querySelector('button')).toBeNull();
  });

  it('handles pointer press/release, leave, cancel, and ignores stray releases', async () => {
    const { m, connector } = setup();
    const turnControl = makeTurnControl();

    const { container } = await act(async () =>
      render(
        <m.Provider connector={connector}>
          <m.HoldToTalkControl className="custom-btn" />
        </m.Provider>,
      ),
    );

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('connected');
      session.emitTurnMode('manual', turnControl);
    });

    const button = must(findButton(container));
    expect(button.textContent).toBe('Hold to talk');
    expect(button.className).toBe('custom-btn');
    expect(button.disabled).toBe(false);

    // Stray pointerUp / pointerLeave without active press does not call endTurn.
    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
      fireEvent.pointerLeave(button, { pointerId: 1 });
    });
    expect(turnControl.endCalls).toBe(0);

    // Normal press/release cycle.
    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    expect(turnControl.startCalls).toBe(1);
    expect(button.dataset.active).toBe('true');

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(turnControl.endCalls).toBe(1);
    expect(button.dataset.active).toBe('false');

    // pointerLeave followed by pointerUp only ends once.
    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 2 });
    });
    await act(async () => {
      fireEvent.pointerLeave(button, { pointerId: 2 });
      fireEvent.pointerUp(button, { pointerId: 2 });
    });
    expect(turnControl.startCalls).toBe(2);
    expect(turnControl.endCalls).toBe(2);

    // pointerCancel ends the press.
    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 3 });
    });
    await act(async () => {
      fireEvent.pointerCancel(button, { pointerId: 3 });
    });
    expect(turnControl.startCalls).toBe(3);
    expect(turnControl.endCalls).toBe(3);
  });

  it('supports keyboard Enter and Space while ignoring repeat', async () => {
    const { m, connector } = setup();
    const turnControl = makeTurnControl();

    const { container } = await act(async () =>
      render(
        <m.Provider connector={connector}>
          <m.HoldToTalkControl />
        </m.Provider>,
      ),
    );

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('connected');
      session.emitTurnMode('manual', turnControl);
    });

    const button = must(findButton(container));
    await act(async () => {
      fireEvent.keyDown(button, { key: ' ', repeat: true });
    });
    expect(turnControl.startCalls).toBe(0);

    await act(async () => {
      fireEvent.keyDown(button, { key: ' ' });
      fireEvent.keyDown(button, { key: 'Enter' });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.keyUp(button, { key: ' ' });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it('ends a hold only when the input that started it is released', async () => {
    const { button, turnControl } = await renderManualControl();

    await act(async () => {
      fireEvent.keyDown(button, { key: ' ' });
      fireEvent.keyDown(button, { key: 'Enter' });
      fireEvent.keyUp(button, { key: 'Enter' });
      fireEvent.pointerLeave(button, { pointerId: 1 });
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(turnControl.startCalls).toBe(1);
    expect(turnControl.endCalls).toBe(0);
    expect(button.dataset.active).toBe('true');

    await act(async () => {
      fireEvent.keyUp(button, { key: ' ' });
    });
    expect(turnControl.endCalls).toBe(1);

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 7 });
      fireEvent.keyUp(button, { key: ' ' });
      fireEvent.pointerUp(button, { pointerId: 8 });
    });
    expect(turnControl.startCalls).toBe(2);
    expect(turnControl.endCalls).toBe(1);

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 7 });
    });
    expect(turnControl.endCalls).toBe(2);
    expect(button.dataset.active).toBe('false');
  });

  it('ignores non-primary mouse presses', async () => {
    const { button, turnControl } = await renderManualControl();

    await act(async () => {
      fireEvent.pointerDown(button, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 2,
      });
    });
    expect(turnControl.startCalls).toBe(0);
    expect(button.dataset.active).toBe('false');

    await act(async () => {
      fireEvent.pointerDown(button, {
        pointerId: 2,
        pointerType: 'mouse',
        button: 0,
      });
    });
    expect(turnControl.startCalls).toBe(1);
    expect(button.dataset.active).toBe('true');
  });

  it('ends an active hold when the button loses focus', async () => {
    const { button, turnControl } = await renderManualControl();

    await act(async () => {
      fireEvent.keyDown(button, { key: ' ' });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.blur(button);
    });
    expect(turnControl.endCalls).toBe(1);
    expect(button.dataset.active).toBe('false');

    await act(async () => {
      fireEvent.keyUp(button, { key: ' ' });
    });
    expect(turnControl.endCalls).toBe(1);

    await act(async () => {
      fireEvent.keyDown(button, { key: ' ' });
    });
    expect(turnControl.startCalls).toBe(2);
  });

  it('ends an active press on disconnect, mode change, unmount, or provider switch', async () => {
    const { m, connector } = setup();
    const turnControl = makeTurnControl();
    let switchProvider!: (next: 'live' | 'realtime') => Promise<void>;

    function Harness() {
      const voice = m.useVoice();
      switchProvider = voice.switchProvider;
      return <m.HoldToTalkControl />;
    }

    const { container, unmount } = await act(async () =>
      render(
        <m.Provider connector={connector}>
          <Harness />
        </m.Provider>,
      ),
    );

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('connected');
      session.emitTurnMode('manual', turnControl);
    });

    // Disconnect mid-press ends the turn and clears the control.
    const button = must(findButton(container));
    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      await session.disconnect();
    });
    expect(turnControl.endCalls).toBe(1);
    expect(findButton(container)).toBeUndefined();

    // Mode change to automatic mid-press ends the turn and hides the button.
    await act(async () => {
      session.emitState('connected');
      session.emitTurnMode('manual', turnControl);
    });
    await act(async () => {
      fireEvent.pointerDown(must(findButton(container)), { pointerId: 2 });
    });
    await act(async () => {
      session.emitTurnMode('automatic', undefined);
    });
    expect(turnControl.startCalls).toBe(2);
    expect(turnControl.endCalls).toBe(2);
    expect(findButton(container)).toBeUndefined();

    // Provider switch mid-press ends the turn and clears the control.
    await act(async () => {
      session.emitTurnMode('manual', turnControl);
    });
    await act(async () => {
      fireEvent.pointerDown(must(findButton(container)), { pointerId: 3 });
    });
    await act(async () => {
      await switchProvider('realtime');
    });
    expect(turnControl.startCalls).toBe(3);
    expect(turnControl.endCalls).toBe(3);
    expect(findButton(container)).toBeUndefined();

    // Unmount mid-press ends the turn.
    const nextSession = must(FakeRealtimeSession.instances[1]);
    const nextTurnControl = makeTurnControl();
    await act(async () => {
      nextSession.emitState('connected');
      nextSession.emitTurnMode('manual', nextTurnControl);
    });
    await act(async () => {
      fireEvent.pointerDown(must(findButton(container)), { pointerId: 4 });
    });
    await act(async () => {
      unmount();
    });
    expect(nextTurnControl.startCalls).toBe(1);
    expect(nextTurnControl.endCalls).toBe(1);
  });

  it('shows generic fallback guidance without rendering or serializing turnModeError', async () => {
    const { m, connector } = setup();
    const turnControl = makeTurnControl();
    const diagnostic = {
      toJSON: () => {
        throw new Error('must not serialize');
      },
      toString: () => {
        throw new Error('must not render');
      },
    };

    const { container } = await act(async () =>
      render(
        <m.Provider connector={connector}>
          <m.HoldToTalkControl guidanceClassName="warn" />
        </m.Provider>,
      ),
    );

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('connected');
      session.emitTurnMode('manual', turnControl, diagnostic);
    });

    expect(container.textContent).toContain(
      'Automatic voice detection unavailable; hold to talk.',
    );
    expect(findButton(container)).toBeDefined();
  });
});
