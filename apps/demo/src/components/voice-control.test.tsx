// @vitest-environment happy-dom

import type { VoiceSessionState } from '@maelstrom-co/client';
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';
import {
  type AdapterTurnControl,
  type GreetingState,
  RealtimeVoiceError,
} from '@maelstrom-co/realtime';
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// voice-control.tsx only touches `m.useVoice` and `m.VoiceOrb` — faking the
// module boundary here isolates these tests from the real Provider/session
// wiring already covered by react-realtime's own test suite.
let voiceResult: UseVoiceResult;

vi.doMock('../lib/maelstrom', () => ({
  m: {
    useVoice: () => voiceResult,
    VoiceOrb: () => <span data-testid="voice-orb" />,
  },
}));

const { VoiceControl } = await import('./voice-control');

function makeTurnControl(onEnd?: () => void): AdapterTurnControl & {
  startCalls: number;
  endCalls: number;
} {
  const turnControl = {
    startCalls: 0,
    endCalls: 0,
    startTurn: async () => {
      turnControl.startCalls += 1;
    },
    endTurn: async () => {
      onEnd?.();
      turnControl.endCalls += 1;
    },
  };
  return turnControl;
}

/** Normal-mode hook fixture; activation controls are no-ops in these turn/greeting tests. */
function makeVoiceResult(
  state: VoiceSessionState,
  turnControl: AdapterTurnControl | undefined,
  turnMode: 'automatic' | 'manual' = 'manual',
  turnModeError: unknown = undefined,
  greetingState: GreetingState = 'not_configured',
  skipGreeting: () => void = () => {},
): UseVoiceResult {
  return {
    state,
    activationState: 'disabled',
    activationConfig: { mode: 'normal' },
    configureActivation: () => {},
    beginChatActivity: () => async () => {},
    error: undefined,
    userTranscript: undefined,
    assistantTranscript: undefined,
    session: {} as never,
    turnControl,
    turnMode,
    turnModeError,
    greetingState,
    connect: async () => {},
    disconnect: async () => {},
    skipGreeting,
  } as UseVoiceResult;
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}

function getHoldButton(container: HTMLElement): HTMLButtonElement {
  return within(container).getByRole('button', {
    name: 'Hold to talk',
  }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
});

describe('VoiceControl greeting Skip action', () => {
  it('renders one native Skip greeting button only while actively preparing and activates it once per click', async () => {
    let skips = 0;
    voiceResult = makeVoiceResult(
      'connected',
      undefined,
      'automatic',
      undefined,
      'preparing',
      () => {
        skips += 1;
      },
    );
    const { getAllByRole, queryAllByRole, rerender } = render(<VoiceControl />);
    const button = getAllByRole('button', {
      name: 'Skip greeting',
    })[0]! as HTMLButtonElement;
    expect(button.type).toBe('button');
    expect(button.className).toContain('min-h-11');
    await act(async () => fireEvent.click(button));
    await act(async () => fireEvent.click(button));
    expect(skips).toBe(2);

    voiceResult = makeVoiceResult(
      'connected',
      undefined,
      'automatic',
      undefined,
      'skipped',
    );
    rerender(<VoiceControl />);
    expect(queryAllByRole('button', { name: 'Skip greeting' })).toHaveLength(0);
  });

  it('activates the native Skip button through Enter and Space keyboard clicks', async () => {
    let skips = 0;
    voiceResult = makeVoiceResult(
      'connected',
      undefined,
      'automatic',
      undefined,
      'preparing',
      () => {
        skips += 1;
      },
    );
    const { getByRole } = render(<VoiceControl />);
    const button = getByRole('button', {
      name: 'Skip greeting',
    }) as HTMLButtonElement;

    // Browsers dispatch click for these native button keyboard activations;
    // exercise both key sequences and their resulting click without requiring
    // a custom keyboard handler in the component.
    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
      fireEvent.keyUp(button, { key: 'Enter' });
      fireEvent.click(button);
      fireEvent.keyDown(button, { key: ' ' });
      fireEvent.keyUp(button, { key: ' ' });
      fireEvent.click(button);
    });

    expect(skips).toBe(2);
  });

  it('keeps Skip outside the sole polite live region with keyboard-ready native button styling', () => {
    voiceResult = makeVoiceResult(
      'connected',
      undefined,
      'automatic',
      undefined,
      'preparing',
    );
    const { getByRole, getByText, getAllByRole, container } = render(
      <VoiceControl />,
    );
    const button = getByRole('button', {
      name: 'Skip greeting',
    }) as HTMLButtonElement;
    const status = getByRole('status');
    expect(getAllByRole('status')).toHaveLength(1);
    expect(status.contains(button)).toBe(false);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(button.className).toContain('focus-visible:');
    expect(button.className).toContain('whitespace-nowrap');
    expect(container.firstElementChild?.className).toContain('flex-wrap');
    expect(getByText('Skip greeting')).toBe(button);
  });

  it.each([
    'idle',
    'error',
  ] as const)('does not render Skip greeting while voice is %s', (state) => {
    voiceResult = makeVoiceResult(
      state,
      undefined,
      'automatic',
      undefined,
      'preparing',
    );
    const { queryByRole } = render(<VoiceControl />);
    expect(queryByRole('button', { name: 'Skip greeting' })).toBeNull();
  });

  it('uses Listening after Skip without replacing active or error labels', () => {
    for (const [state, label] of [
      ['connected', 'Listening'],
      ['listening', 'Listening'],
      ['thinking', 'Thinking…'],
      ['speaking', 'Speaking…'],
      ['error', 'Voice error'],
    ] as const) {
      voiceResult = makeVoiceResult(
        state,
        undefined,
        'automatic',
        undefined,
        'skipped',
      );
      const { container, unmount } = render(<VoiceControl />);
      expect(container.textContent).toContain(label);
      unmount();
    }
  });

  it.each([
    [
      new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'OpenAI realtime call setup failed with status 403',
      ),
      'OpenAI voice failed (HTTP 403)',
    ],
    [
      new RealtimeVoiceError('MIC_PERMISSION_DENIED', 'blocked'),
      'Microphone blocked',
    ],
    [new Error('provider payload must stay hidden'), 'Voice error'],
  ])('shows a safe actionable error status', (error, expected) => {
    voiceResult = {
      ...makeVoiceResult('error', undefined, 'automatic'),
      error,
    };

    const { getByRole, container } = render(<VoiceControl />);

    expect(getByRole('status').textContent).toContain(expected);
    expect(container.textContent).not.toContain(
      'provider payload must stay hidden',
    );
  });
});

describe('VoiceControl hold-to-talk button', () => {
  it.each([
    ['connecting', 'Connecting…'],
    ['connected', 'Preparing greeting…'],
  ] as const)('shows preparation while the voice is %s', (state, label) => {
    voiceResult = makeVoiceResult(
      state,
      undefined,
      'automatic',
      undefined,
      'preparing',
    );
    const { getAllByRole, getByRole, queryByRole } = render(<VoiceControl />);

    expect(getAllByRole('status')).toHaveLength(1);
    expect(getByRole('status').textContent).toContain(label);
    expect(queryByRole('progressbar')).toBeNull();
  });

  it.each([
    ['listening', 'Listening'],
    ['thinking', 'Thinking…'],
    ['speaking', 'Speaking…'],
  ] as const)('keeps the %s activity visible during preparation', (state, label) => {
    voiceResult = makeVoiceResult(
      state,
      undefined,
      'automatic',
      undefined,
      'preparing',
    );
    const { getAllByRole, getByRole, queryByRole } = render(<VoiceControl />);

    expect(getAllByRole('status')).toHaveLength(1);
    expect(getByRole('status').textContent).toContain(label);
    expect(queryByRole('progressbar')).toBeNull();
  });

  it('keeps fatal and disconnected presentation ahead of greeting preparation', () => {
    for (const state of ['error', 'idle'] as const) {
      voiceResult = makeVoiceResult(
        state,
        undefined,
        'automatic',
        undefined,
        'preparing',
      );
      const { container, unmount } = render(<VoiceControl />);
      expect(container.textContent).toContain(
        state === 'error' ? 'Voice error' : 'Voice off',
      );
      expect(container.textContent).not.toContain('Preparing greeting…');
      unmount();
    }
  });

  it('uses greeting settlement without replacing real thinking and speaking labels', () => {
    const cases = [
      ['connected', 'Listening'],
      ['thinking', 'Thinking…'],
      ['speaking', 'Speaking…'],
    ] as const;
    for (const [state, label] of cases) {
      voiceResult = makeVoiceResult(
        state,
        undefined,
        'automatic',
        undefined,
        'settled',
      );
      const { container, unmount } = render(<VoiceControl />);
      expect(container.textContent).toContain(label);
      unmount();
    }
  });

  it('keeps LiveKit manual degradation controls visible and non-live during preparation', () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult(
      'connected',
      turnControl,
      'manual',
      new Error('VAD unavailable'),
      'preparing',
    );
    const { getAllByRole, getByRole, queryByRole, container } = render(
      <VoiceControl />,
    );

    expect(getAllByRole('status')).toHaveLength(1);
    expect(getByRole('status').textContent).toContain('Preparing greeting…');
    expect(queryByRole('progressbar')).toBeNull();
    expect(getHoldButton(container)).toBeDefined();
    expect(container.textContent).toContain(
      'Automatic voice detection unavailable; hold to talk.',
    );
    expect(container.firstElementChild?.className).toContain('min-w-0');
  });

  it('renders the inline orb by default', () => {
    voiceResult = makeVoiceResult('connected', undefined, 'automatic');

    const { getByTestId } = render(<VoiceControl />);

    expect(getByTestId('voice-orb')).toBeDefined();
  });

  it('can hide the inline orb when the shell already renders one', () => {
    voiceResult = makeVoiceResult('connected', undefined, 'automatic');

    const { queryByTestId } = render(<VoiceControl showOrb={false} />);

    expect(queryByTestId('voice-orb')).toBeNull();
  });

  it('renders the button with a working pointer down/up cycle', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);
    expect(button.tagName).toBe('BUTTON');

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it('ends the turn on pointerLeave even when the state snapshot is stale (not yet "listening")', async () => {
    const turnControl = makeTurnControl();
    // Simulates the race: startTurn was fired, but the async state
    // transition to 'listening' has not landed in a re-render yet when the
    // pointer leaves the button.
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.pointerLeave(button, { pointerId: 1 });
    });

    expect(turnControl.endCalls).toBe(1);
  });

  it('ends the turn on pointerCancel', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerCancel(button, { pointerId: 1 });
    });

    expect(turnControl.endCalls).toBe(1);
  });

  it('does not call endTurn from pointerUp/pointerLeave when no press is active', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerLeave(button, { pointerId: 1 });
    });

    expect(turnControl.endCalls).toBe(0);
  });

  it('does not double-fire endTurn when pointerLeave is followed by pointerUp for the same press', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerLeave(button, { pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });

    expect(turnControl.endCalls).toBe(1);
  });

  it('captures the pointer on pointerDown so up/cancel reliably target the button', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);
    let capturedId: number | undefined;
    button.setPointerCapture = (pointerId: number) => {
      capturedId = pointerId;
    };

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 7 });
    });

    expect(capturedId).toBe(7);
  });

  it('starts a turn on Enter keydown and ends it on Enter keyup', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.keyUp(button, { key: 'Enter' });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it('starts a turn on Space keydown and ends it on Space keyup', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: ' ' });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.keyUp(button, { key: ' ' });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it('ignores keydown repeats from OS key-repeat', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
    });
    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter', repeat: true });
    });
    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter', repeat: true });
    });

    expect(turnControl.startCalls).toBe(1);
  });

  it('ignores keys other than Enter/Space', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: 'a' });
    });
    await act(async () => {
      fireEvent.keyUp(button, { key: 'a' });
    });

    expect(turnControl.startCalls).toBe(0);
    expect(turnControl.endCalls).toBe(0);
  });

  it('shares one press across pointer and keyboard so an in-progress pointer press is not restarted by a stray Enter keydown', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
    });
    // The pointer press already owns the turn; keydown must not start a
    // second one.
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it('recovers keyboard push-to-talk after a fatal disconnect mid-press', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container, rerender } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
    });
    expect(turnControl.startCalls).toBe(1);

    // Fatal adapter error flips the session out of a connected state before
    // the key-up (or pointer-up) ever fires — the browser suppresses
    // events once the button becomes disabled, so nothing clears the press.
    voiceResult = makeVoiceResult('error', turnControl);
    await act(async () => {
      rerender(<VoiceControl />);
    });

    voiceResult = makeVoiceResult('connected', turnControl);
    await act(async () => {
      rerender(<VoiceControl />);
    });

    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
    });

    expect(turnControl.startCalls).toBe(2);
  });

  it('ends an active pointer press once before automatic mode hides the button', async () => {
    let renderedContainer: HTMLElement | undefined;
    let buttonVisibleWhenEnded = false;
    const turnControl = makeTurnControl(() => {
      const root = must(
        must(renderedContainer).firstChild as HTMLElement | null,
      );
      buttonVisibleWhenEnded = Array.from(root.children).some(
        (el) => el.tagName === 'BUTTON',
      );
    });
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container, rerender } = render(<VoiceControl />);
    renderedContainer = container;
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });

    voiceResult = makeVoiceResult('connected', turnControl, 'automatic');
    await act(async () => {
      rerender(<VoiceControl />);
    });

    expect(turnControl.endCalls).toBe(1);
    expect(buttonVisibleWhenEnded).toBe(true);
    const root = must(container.firstChild as HTMLElement | null);
    expect(
      Array.from(root.children).some((el) => el.tagName === 'BUTTON'),
    ).toBe(false);

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it('ends an active keyboard press once before automatic mode hides the button', async () => {
    let renderedContainer: HTMLElement | undefined;
    let buttonVisibleWhenEnded = false;
    const turnControl = makeTurnControl(() => {
      const root = must(
        must(renderedContainer).firstChild as HTMLElement | null,
      );
      buttonVisibleWhenEnded = Array.from(root.children).some(
        (el) => el.tagName === 'BUTTON',
      );
    });
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container, rerender } = render(<VoiceControl />);
    renderedContainer = container;
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
    });

    voiceResult = makeVoiceResult('connected', turnControl, 'automatic');
    await act(async () => {
      rerender(<VoiceControl />);
    });

    expect(turnControl.endCalls).toBe(1);
    expect(buttonVisibleWhenEnded).toBe(true);
    const root = must(container.firstChild as HTMLElement | null);
    expect(
      Array.from(root.children).some((el) => el.tagName === 'BUTTON'),
    ).toBe(false);

    await act(async () => {
      fireEvent.keyUp(button, { key: 'Enter' });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it('ends an active pointer press once when unmounted and ignores a stale release', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container, unmount } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    await act(async () => {
      unmount();
    });

    expect(turnControl.endCalls).toBe(1);

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it('ends an active keyboard press once when unmounted and ignores a stale release', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { container, unmount } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
    });
    await act(async () => {
      unmount();
    });

    expect(turnControl.endCalls).toBe(1);

    await act(async () => {
      fireEvent.keyUp(button, { key: 'Enter' });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it('does not end a turn when automatic mode takes over without an active press', async () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl);

    const { rerender } = render(<VoiceControl />);

    voiceResult = makeVoiceResult('connected', turnControl, 'automatic');
    await act(async () => {
      rerender(<VoiceControl />);
    });

    expect(turnControl.endCalls).toBe(0);
  });

  it('does not render the hold-to-talk button when turnControl is absent', async () => {
    voiceResult = makeVoiceResult('connected', undefined);

    const { container } = render(<VoiceControl />);
    const root = must(container.firstChild as HTMLElement | null);

    expect(
      Array.from(root.children).some((el) => el.tagName === 'BUTTON'),
    ).toBe(false);
  });

  it('hides hold-to-talk while automatic VAD controls turns', () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl, 'automatic');

    const { container } = render(<VoiceControl />);
    const root = must(container.firstChild as HTMLElement | null);

    expect(
      Array.from(root.children).some((el) => el.tagName === 'BUTTON'),
    ).toBe(false);
  });

  it('shows hold-to-talk without recovery guidance for intentional manual mode', () => {
    const turnControl = makeTurnControl();
    voiceResult = makeVoiceResult('connected', turnControl, 'manual');

    const { container } = render(<VoiceControl />);

    expect(getHoldButton(container)).toBeDefined();
    expect(container.textContent).not.toContain(
      'Automatic voice detection unavailable; hold to talk.',
    );
  });

  it('shows generic recovery guidance without rendering or serializing the turn-mode error', () => {
    const turnControl = makeTurnControl();
    const diagnostic = {
      toJSON: () => {
        throw new Error('diagnostic must not be serialized');
      },
      toString: () => {
        throw new Error('diagnostic must not be rendered');
      },
    };
    voiceResult = makeVoiceResult(
      'connected',
      turnControl,
      'manual',
      diagnostic,
    );

    const { container } = render(<VoiceControl />);

    expect(getHoldButton(container)).toBeDefined();
    expect(container.textContent).toContain(
      'Automatic voice detection unavailable; hold to talk.',
    );
    expect(container.textContent).not.toContain('diagnostic');
  });
});
