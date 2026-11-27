// @vitest-environment happy-dom

import type { VoiceSessionState } from '@maelstrom-co/client';
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';
import type { AdapterTurnControl } from '@maelstrom-co/realtime';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_VOICE_OBSERVATIONS } from '../lib/__tests__/fake-realtime-session';
import { createVoiceMuteToggleStub } from '../lib/__tests__/voice-mute-toggle-stub';
import type { DemoVoiceProvider } from '../lib/voice-provider';

type ShopVoiceResult = UseVoiceResult<DemoVoiceProvider>;

let voiceResult: ShopVoiceResult;
const orbClick = vi.fn();
const prepareBrowserOpenAIVoice = vi.fn(() => true);
const resumePlayback = vi.fn(async () => {});

vi.doMock('./maelstrom', () => ({
  shopM: {
    useVoice: () => voiceResult,
    useVoiceObservations: () => ({ snapshot: EMPTY_VOICE_OBSERVATIONS }),
    useVoiceCaptions: () => ({ user: undefined, assistant: undefined }),
    VoiceOrb: (props: { className?: string }) => (
      <button
        type="button"
        data-testid="voice-orb"
        className={props.className}
        onClick={orbClick}
      />
    ),
    HoldToTalkControl: (props: { className?: string }) => (
      <button
        type="button"
        data-testid="hold-to-talk"
        className={props.className}
      >
        Hold to talk
      </button>
    ),
    VoiceMuteToggle: createVoiceMuteToggleStub(() => voiceResult),
  },
}));

vi.doMock('../lib/voice-adapter', () => ({ prepareBrowserOpenAIVoice }));

const { ShopVoiceCorner, voicePillLabel } = await import('./shop-voice-corner');

function makeVoiceResult(
  state: VoiceSessionState,
  overrides: Partial<ShopVoiceResult> = {},
): ShopVoiceResult {
  return {
    state,
    provider: 'realtime',
    switching: false,
    turnMode: 'automatic',
    inputMuted: false,
    setInputMuted: vi.fn(),
    playbackBlocked: false,
    resumePlayback,
    ...overrides,
  } as ShopVoiceResult;
}

function makeTurnControl() {
  return {
    startTurn: vi.fn(async () => {}),
    endTurn: vi.fn(async () => {}),
  } satisfies AdapterTurnControl;
}

function renderCorner(state: VoiceSessionState, needsKey = false) {
  voiceResult = makeVoiceResult(state);
  const onRequireKey = vi.fn();
  const utils = render(
    <ShopVoiceCorner needsKey={needsKey} onRequireKey={onRequireKey} />,
  );
  return { ...utils, onRequireKey };
}

beforeEach(() => {
  orbClick.mockClear();
  prepareBrowserOpenAIVoice.mockClear();
  resumePlayback.mockClear();
});

afterEach(cleanup);

describe('ShopVoiceCorner', () => {
  it('renders the orb', () => {
    const { getByTestId } = renderCorner('idle');
    expect(getByTestId('voice-orb').className).toBe('voice-orb');
  });

  it.each([
    ['idle', 'Tap to talk'],
    ['connecting', 'Connecting'],
    ['connected', 'Listening'],
    ['listening', 'Listening'],
    ['thinking', 'Thinking'],
    ['speaking', 'Speaking'],
    ['error', 'Voice error'],
  ] as const)('shows %s as "%s"', (state, label) => {
    const { getByRole } = renderCorner(state);
    expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
      label,
    );
    expect(voicePillLabel(state)).toBe(label);
  });

  it('keeps the caption band mounted while idle', () => {
    const { getByTestId } = renderCorner('idle');
    expect(getByTestId('shop-caption')).toBeTruthy();
  });

  it('stacks the agent reply under the caption in the same band', () => {
    voiceResult = makeVoiceResult('listening');
    const { getByTestId } = render(
      <ShopVoiceCorner
        needsKey={false}
        onRequireKey={vi.fn()}
        reply={<div data-testid="agent-reply-slot" />}
      />,
    );

    const band = getByTestId('shop-caption').parentElement;
    expect(band?.className).toBe('shop-voice-text');
    expect([...(band?.children ?? [])]).toEqual([
      getByTestId('shop-caption'),
      getByTestId('agent-reply-slot'),
    ]);
  });

  it('always shows the AI voice disclosure', () => {
    const { getByTestId } = renderCorner('idle');
    expect(getByTestId('ai-voice-disclosure').textContent).toBe(
      'AI-generated voice',
    );
  });

  it('intercepts the orb click when a key is needed', () => {
    const { getByTestId, onRequireKey } = renderCorner('idle', true);
    fireEvent.click(getByTestId('voice-orb'));
    expect(onRequireKey).toHaveBeenCalledTimes(1);
    expect(orbClick).not.toHaveBeenCalled();
    expect(prepareBrowserOpenAIVoice).not.toHaveBeenCalled();
  });

  it('prepares the browser voice before the orb connects from idle', () => {
    const { getByTestId, onRequireKey } = renderCorner('idle');
    fireEvent.click(getByTestId('voice-orb'));
    expect(prepareBrowserOpenAIVoice).toHaveBeenCalledTimes(1);
    expect(orbClick).toHaveBeenCalledTimes(1);
    expect(onRequireKey).not.toHaveBeenCalled();
  });

  it('prepares the browser voice before reconnecting from error', () => {
    const { getByTestId } = renderCorner('error');
    fireEvent.click(getByTestId('voice-orb'));
    expect(prepareBrowserOpenAIVoice).toHaveBeenCalledTimes(1);
    expect(orbClick).toHaveBeenCalledTimes(1);
  });

  it('does not prepare when the tap will disconnect a live session', () => {
    const { getByTestId } = renderCorner('listening');
    fireEvent.click(getByTestId('voice-orb'));
    expect(prepareBrowserOpenAIVoice).not.toHaveBeenCalled();
    expect(orbClick).toHaveBeenCalledTimes(1);
  });
});

describe('ShopVoiceCorner playback recovery', () => {
  function renderVoice(
    state: VoiceSessionState,
    overrides: Partial<ShopVoiceResult> = {},
  ) {
    voiceResult = makeVoiceResult(state, {
      provider: 'live',
      ...overrides,
    });
    return render(<ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />);
  }

  it('keeps the status pill while playback is not blocked', () => {
    const { getByRole, queryByRole } = renderVoice('listening', {
      playbackBlocked: false,
    });
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
    expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
      'Listening',
    );
  });

  it('shows Enable playback in place of the pill while playback is blocked', () => {
    const { container, getByRole, queryByRole } = renderVoice('listening', {
      playbackBlocked: true,
    });
    const button = getByRole('button', { name: 'Enable playback' });
    expect(queryByRole('status', { name: 'Voice status' })).toBeNull();
    expect(button.parentElement?.className).toBe('shop-voice-status');
    expect(container.querySelector('.shop-voice-actions')).toBeNull();
  });

  it('calls resumePlayback from a click on Enable playback', () => {
    const { getByRole } = renderVoice('connected', { playbackBlocked: true });
    fireEvent.click(getByRole('button', { name: 'Enable playback' }));
    expect(resumePlayback).toHaveBeenCalledTimes(1);
  });

  it('brings the pill back once blocked playback clears', () => {
    const { getByRole, queryByRole, rerender } = renderVoice('speaking', {
      playbackBlocked: true,
    });
    expect(getByRole('button', { name: 'Enable playback' })).toBeTruthy();
    voiceResult = makeVoiceResult('speaking', {
      provider: 'live',
      playbackBlocked: false,
    });
    rerender(<ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />);
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
    expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
      'Speaking',
    );
  });

  it('shows Enable playback when playback becomes blocked after render', () => {
    const { getByRole, queryByRole, rerender } = renderVoice('listening', {
      playbackBlocked: false,
    });
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
    voiceResult = makeVoiceResult('listening', {
      provider: 'live',
      playbackBlocked: true,
    });
    rerender(<ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />);
    expect(getByRole('button', { name: 'Enable playback' })).toBeTruthy();
  });

  it.each(['idle', 'connecting', 'error'] as const)(
    'keeps the pill while %s even if playbackBlocked is true',
    (state) => {
      const { getByRole, queryByRole } = renderVoice(state, {
        playbackBlocked: true,
      });
      expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
      expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
        voicePillLabel(state),
      );
    },
  );

  it('disables Enable playback while the provider switches', () => {
    const { getByRole } = renderVoice('connected', {
      playbackBlocked: true,
      switching: true,
    });
    const button = getByRole('button', { name: 'Enable playback' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('keeps the status pill on OpenAI Realtime even while playback is blocked', () => {
    const { getByRole, queryByRole } = renderVoice('connected', {
      provider: 'realtime',
      playbackBlocked: true,
    });
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
    expect(getByRole('status', { name: 'Voice status' })).toBeTruthy();
  });
});

describe('ShopVoiceCorner turn controls', () => {
  it('mounts the SDK hold-to-talk control and the hold mode switch', () => {
    voiceResult = makeVoiceResult('connected', {
      provider: 'live',
      turnMode: 'manual',
      turnControl: { ...makeTurnControl(), setTurnMode: vi.fn(async () => {}) },
    });
    const { getByRole } = render(
      <ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />,
    );
    expect(getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
    expect(getByRole('switch', { name: 'Hold mode' })).toBeTruthy();
  });

  it.each([
    ['connected', 'Ready'],
    ['listening', 'Listening'],
  ] as const)(
    'labels a manual %s session %s while hold-to-talk is shown',
    (state, label) => {
      voiceResult = makeVoiceResult(state, {
        provider: 'live',
        turnMode: 'manual',
        turnControl: makeTurnControl(),
      });
      const { getByRole } = render(
        <ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />,
      );
      expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
        label,
      );
    },
  );

  it('keeps Listening for a connected manual session without turnControl', () => {
    voiceResult = makeVoiceResult('connected', {
      provider: 'live',
      turnMode: 'manual',
      turnControl: undefined,
    });
    const { getByRole } = render(
      <ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />,
    );
    expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
      'Listening',
    );
  });
});
