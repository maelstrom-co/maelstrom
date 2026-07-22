// @vitest-environment happy-dom

import type { VoiceSessionState } from '@maelstrom-co/client';
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';
import type {
  AdapterTurnControl,
  RealtimeSession,
} from '@maelstrom-co/realtime';
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';

// voice-control.tsx only touches `m.useVoice` and `m.VoiceOrb` — faking the
// module boundary here isolates these tests from the real Provider/session
// wiring already covered by react-realtime's own test suite.
const holder = vi.hoisted(() => ({
  voiceResult: undefined as unknown as UseVoiceResult,
}));

vi.mock('../lib/maelstrom', () => ({
  m: {
    useVoice: () => holder.voiceResult,
    VoiceOrb: () => null,
  },
}));

const { VoiceControl } = await import("./voice-control");

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

function makeVoiceResult(
  state: VoiceSessionState,
  turnControl: AdapterTurnControl | undefined,
  turnMode: "automatic" | "manual" = "manual",
  vadError: unknown = undefined,
): UseVoiceResult {
  return {
    state,
    error: undefined,
    userTranscript: undefined,
    assistantTranscript: undefined,
    session: new FakeRealtimeSession(undefined) as unknown as RealtimeSession,
    turnControl,
    turnMode,
    vadError,
    connect: async () => {},
    disconnect: async () => {},
  };
}

// Queried by role and accessible name (its "Hold to talk" text content)
// rather than DOM position, so the test survives a sibling being added.
function getHoldButton(container: HTMLElement): HTMLButtonElement {
  return within(container).getByRole('button', { name: /hold to talk/i });
}

afterEach(() => {
  cleanup();
});

describe("VoiceControl hold-to-talk button", () => {
  it("renders the button with a working pointer down/up cycle", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);
    expect(button.tagName).toBe("BUTTON");

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

  it("ends the turn on pointerCancel", async () => {
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

  it("does not call endTurn from pointerUp/pointerLeave when no press is active", async () => {
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

  it("does not double-fire endTurn when pointerLeave is followed by pointerUp for the same press", async () => {
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

  it("captures the pointer on pointerDown so up/cancel reliably target the button", async () => {
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

  it("starts a turn on Enter keydown and ends it on Enter keyup", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: "Enter" });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.keyUp(button, { key: "Enter" });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it("starts a turn on Space keydown and ends it on Space keyup", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: " " });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.keyUp(button, { key: " " });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it("ignores keydown repeats from OS key-repeat", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.keyDown(button, { key: "Enter", repeat: true });
    });
    await act(async () => {
      fireEvent.keyDown(button, { key: "Enter", repeat: true });
    });

    expect(turnControl.startCalls).toBe(1);
  });

  it("ignores keys other than Enter/Space", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: "a" });
    });
    await act(async () => {
      fireEvent.keyUp(button, { key: "a" });
    });

    expect(turnControl.startCalls).toBe(0);
    expect(turnControl.endCalls).toBe(0);
  });

  it("shares one press across pointer and keyboard so an in-progress pointer press is not restarted by a stray Enter keydown", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.keyDown(button, { key: "Enter" });
    });
    // The pointer press already owns the turn; keydown must not start a
    // second one.
    expect(turnControl.startCalls).toBe(1);

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it("recovers keyboard push-to-talk after a fatal disconnect mid-press", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container, rerender } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: "Enter" });
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
      fireEvent.keyDown(button, { key: "Enter" });
    });

    expect(turnControl.startCalls).toBe(2);
  });

  it("ends an active pointer press once before automatic mode hides the button", async () => {
    let renderedContainer: HTMLElement | undefined;
    let buttonVisibleWhenEnded = false;
    const turnControl = makeTurnControl(() => {
      buttonVisibleWhenEnded =
        renderedContainer !== undefined &&
        within(renderedContainer).queryByRole('button', {
          name: /hold to talk/i,
        }) !== null;
    });
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container, rerender } = render(<VoiceControl />);
    renderedContainer = container;
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });

    holder.voiceResult = makeVoiceResult(
      'connected',
      turnControl,
      'automatic',
    );
    await act(async () => {
      rerender(<VoiceControl />);
    });

    expect(turnControl.endCalls).toBe(1);
    expect(buttonVisibleWhenEnded).toBe(true);
    expect(within(container).queryByRole('button')).toBeNull();

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it("ends an active keyboard press once before automatic mode hides the button", async () => {
    let renderedContainer: HTMLElement | undefined;
    let buttonVisibleWhenEnded = false;
    const turnControl = makeTurnControl(() => {
      buttonVisibleWhenEnded =
        renderedContainer !== undefined &&
        within(renderedContainer).queryByRole('button', {
          name: /hold to talk/i,
        }) !== null;
    });
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container, rerender } = render(<VoiceControl />);
    renderedContainer = container;
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: "Enter" });
    });

    holder.voiceResult = makeVoiceResult(
      'connected',
      turnControl,
      'automatic',
    );
    await act(async () => {
      rerender(<VoiceControl />);
    });

    expect(turnControl.endCalls).toBe(1);
    expect(buttonVisibleWhenEnded).toBe(true);
    expect(within(container).queryByRole('button')).toBeNull();

    await act(async () => {
      fireEvent.keyUp(button, { key: "Enter" });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it("ends an active pointer press once when unmounted and ignores a stale release", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

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

  it("ends an active keyboard press once when unmounted and ignores a stale release", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { container, unmount } = render(<VoiceControl />);
    const button = getHoldButton(container);

    await act(async () => {
      fireEvent.keyDown(button, { key: "Enter" });
    });
    await act(async () => {
      unmount();
    });

    expect(turnControl.endCalls).toBe(1);

    await act(async () => {
      fireEvent.keyUp(button, { key: "Enter" });
    });
    expect(turnControl.endCalls).toBe(1);
  });

  it("does not end a turn when automatic mode takes over without an active press", async () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl);

    const { rerender } = render(<VoiceControl />);

    holder.voiceResult = makeVoiceResult(
      'connected',
      turnControl,
      'automatic',
    );
    await act(async () => {
      rerender(<VoiceControl />);
    });

    expect(turnControl.endCalls).toBe(0);
  });

  it("does not render the hold-to-talk button when turnControl is absent", async () => {
    holder.voiceResult = makeVoiceResult('connected', undefined);

    const { container } = render(<VoiceControl />);

    expect(within(container).queryByRole('button')).toBeNull();
  });

  it("hides hold-to-talk while automatic VAD controls turns", () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult('connected', turnControl, 'automatic');

    const { container } = render(<VoiceControl />);

    expect(within(container).queryByRole('button')).toBeNull();
    expect(within(container).queryByRole('status')).toBeNull();
  });

  it("shows hold-to-talk and a concise fallback message when VAD uses manual mode", () => {
    const turnControl = makeTurnControl();
    holder.voiceResult = makeVoiceResult(
      'connected',
      turnControl,
      "manual",
      new Error("assets unavailable"),
    );

    const { container } = render(<VoiceControl />);

    expect(getHoldButton(container)).toBeDefined();
    expect(container.textContent).toContain(
      "Automatic voice detection unavailable; hold to talk.",
    );
    expect(container.textContent).not.toContain('assets unavailable');
  });
});
