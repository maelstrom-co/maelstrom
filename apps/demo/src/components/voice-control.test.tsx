// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { VoiceSessionState } from '@maelstrom-co/client';
import type { AdapterTurnControl } from '@maelstrom-co/realtime';
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';

// voice-control.tsx only touches `m.useVoice` and `m.VoiceOrb` — faking the
// module boundary here isolates these tests from the real Provider/session
// wiring already covered by react-realtime's own test suite.
const holder = vi.hoisted(
  () => ({ voiceResult: undefined as unknown as UseVoiceResult }),
);

vi.mock('../lib/maelstrom', () => ({
  m: {
    useVoice: () => holder.voiceResult,
    VoiceOrb: () => null,
  },
}));

const { VoiceControl } = await import('./voice-control');

function makeTurnControl(): AdapterTurnControl & { startCalls: number; endCalls: number } {
  const turnControl = {
    startCalls: 0,
    endCalls: 0,
    startTurn: async () => {
      turnControl.startCalls += 1;
    },
    endTurn: async () => {
      turnControl.endCalls += 1;
    },
  };
  return turnControl;
}

function makeVoiceResult(
  state: VoiceSessionState,
  turnControl: AdapterTurnControl | undefined,
): UseVoiceResult {
  return {
    state,
    error: undefined,
    userTranscript: undefined,
    assistantTranscript: undefined,
    session: {} as never,
    turnControl,
    connect: async () => {},
    disconnect: async () => {},
  };
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected value to be defined');
  return value;
}

// container's root is the wrapping <div>; the hold-to-talk button is its
// last child (VoiceOrb is mocked to render null).
function getHoldButton(container: HTMLElement): HTMLButtonElement {
  const root = must(container.firstChild as HTMLElement | null);
  const button = root.lastElementChild as HTMLButtonElement | null;
  return must(button);
}

afterEach(() => {
  cleanup();
});

describe('VoiceControl hold-to-talk button', () => {
  it('renders the button with a working pointer down/up cycle', async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container, rerender } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
    });
    expect(turnControl.startCalls).toBe(1);

    // Fatal adapter error flips the session out of a connected state before
    // the key-up (or pointer-up) ever fires — the browser suppresses
    // events once the button becomes disabled, so nothing clears the press.
    holder.voiceResult = makeVoiceResult('error', turnControl);
    await act(async () => {
      rerender(<VoiceControl />);
    });

    holder.voiceResult = makeVoiceResult('connected', turnControl);
    await act(async () => {
      rerender(<VoiceControl />);
    });

    await act(async () => {
      fireEvent.keyDown(button, { key: 'Enter' });
    });

    expect(turnControl.startCalls).toBe(2);
  });

  it('does not render the hold-to-talk button when turnControl is absent', async () => {
    holder.voiceResult = makeVoiceResult('connected', undefined);

    const { container } = render(<VoiceControl />);
    const root = must(container.firstChild as HTMLElement | null);

    expect(Array.from(root.children).some((el) => el.tagName === 'BUTTON')).toBe(false);
  });
});
