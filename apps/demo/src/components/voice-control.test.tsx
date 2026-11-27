// @vitest-environment happy-dom

import type { VoiceSessionState } from '@maelstrom-co/client';
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';
import {
  type AdapterTurnControl,
  type GreetingState,
  RealtimeVoiceError,
} from '@maelstrom-co/realtime';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_VOICE_OBSERVATIONS } from '../lib/__tests__/fake-realtime-session';

// voice-control.tsx only touches `m.useVoice`, `m.useVoiceObservations`,
// `m.VoiceOrb`, and `m.HoldToTalkControl` — faking the module boundary here
// isolates these tests from the real Provider/session and SDK control wiring
// already covered by react-realtime's own test suite.
let voiceResult: UseVoiceResult;

vi.doMock('../lib/maelstrom', () => ({
  m: {
    useVoice: () => voiceResult,
    useVoiceObservations: () => ({ snapshot: EMPTY_VOICE_OBSERVATIONS }),
    VoiceOrb: () => <span data-testid="voice-orb" />,
    HoldToTalkControl: (props: {
      className?: string;
      guidanceClassName?: string;
    }) => (
      <span
        data-testid="hold-to-talk"
        data-class={props.className}
        data-guidance-class={props.guidanceClassName}
      />
    ),
  },
}));

const { VoiceControl } = await import('./voice-control');

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
    error: undefined,
    userTranscript: undefined,
    assistantTranscript: undefined,
    session: {} as never,
    provider: undefined,
    switching: false,
    switchProvider: async () => {},
    turnControl,
    turnMode,
    turnModeError,
    greetingState,
    connect: async () => {},
    disconnect: async () => {},
    skipGreeting,
  } as UseVoiceResult;
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

  it.each(['idle', 'error'] as const)(
    'does not render Skip greeting while voice is %s',
    (state) => {
      voiceResult = makeVoiceResult(
        state,
        undefined,
        'automatic',
        undefined,
        'preparing',
      );
      const { queryByRole } = render(<VoiceControl />);
      expect(queryByRole('button', { name: 'Skip greeting' })).toBeNull();
    },
  );

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

describe('VoiceControl status and SDK controls', () => {
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
  ] as const)(
    'keeps the %s activity visible during preparation',
    (state, label) => {
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
    },
  );

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

  it('renders the inline orb by default and mounts the SDK HoldToTalkControl', () => {
    voiceResult = makeVoiceResult('connected', undefined, 'automatic');

    const { getByTestId } = render(<VoiceControl />);

    expect(getByTestId('voice-orb')).toBeDefined();
    expect(getByTestId('hold-to-talk')).toBeDefined();
    expect(getByTestId('hold-to-talk').getAttribute('data-class')).toContain(
      'status-pill',
    );
    expect(
      getByTestId('hold-to-talk').getAttribute('data-guidance-class'),
    ).toContain('text-amber-300');
  });

  it('mounts the hold mode switch', () => {
    voiceResult = makeVoiceResult(
      'connected',
      {
        startTurn: async () => {},
        endTurn: async () => {},
        setTurnMode: async () => {},
      },
      'automatic',
    );
    const { getByRole } = render(<VoiceControl />);
    expect(getByRole('switch', { name: 'Hold mode' })).toBeDefined();
  });

  it('can hide the inline orb when the shell already renders one', () => {
    voiceResult = makeVoiceResult('connected', undefined, 'automatic');

    const { queryByTestId } = render(<VoiceControl showOrb={false} />);

    expect(queryByTestId('voice-orb')).toBeNull();
  });
});
