// @vitest-environment happy-dom

import type { VoiceSessionState } from '@maelstrom-co/client';
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';
import type { AdapterTurnControl } from '@maelstrom-co/realtime';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_VOICE_OBSERVATIONS } from '../lib/__tests__/fake-realtime-session';
import type { DemoVoiceProvider } from '../lib/voice-provider';

type ShopVoiceResult = UseVoiceResult<DemoVoiceProvider>;

let voiceResult: ShopVoiceResult;
const orbClick = vi.fn();
const prepareBrowserOpenAIVoice = vi.fn(() => true);

vi.doMock('./maelstrom', () => ({
  shopM: {
    useVoice: () => voiceResult,
    useVoiceObservations: () => ({ snapshot: EMPTY_VOICE_OBSERVATIONS }),
    VoiceOrb: (props: { className?: string }) => (
      <button
        type="button"
        data-testid="voice-orb"
        className={props.className}
        onClick={orbClick}
      />
    ),
  },
}));

vi.doMock('../lib/voice-adapter', () => ({ prepareBrowserOpenAIVoice }));

const activateAudio = vi.fn(async () => {});
class FakeLiveAdapter {
  activateAudio = activateAudio;
}
const liveSession = {};
vi.doMock('@maelstrom-co/realtime-openai-live', () => ({
  OpenAILiveAdapter: FakeLiveAdapter,
}));
vi.doMock('../lib/demo-voice', () => ({
  demoVoiceSession: (session: unknown) =>
    session === liveSession ? { adapter: new FakeLiveAdapter() } : undefined,
}));

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
  activateAudio.mockClear();
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

describe('ShopVoiceCorner hold-to-talk fallback', () => {
  function renderManual(
    state: VoiceSessionState,
    turnControl: AdapterTurnControl | undefined,
    overrides: Partial<ShopVoiceResult> = {},
  ) {
    voiceResult = makeVoiceResult(state, {
      turnMode: 'manual',
      turnControl,
      ...overrides,
    });
    return render(<ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />);
  }

  it('starts and ends a manual turn while the button is held', async () => {
    const turnControl = makeTurnControl();
    const { getByRole } = renderManual('connected', turnControl);
    const button = getByRole('button', { name: 'Hold to talk' });
    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1 });
    });
    expect(turnControl.startTurn).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(turnControl.endTurn).toHaveBeenCalledTimes(1);
  });

  it('explains the fallback when automatic voice detection failed', () => {
    const { getByText } = renderManual('connected', makeTurnControl(), {
      turnModeError: new Error('vad failed'),
    });
    expect(
      getByText('Automatic voice detection unavailable; hold to talk.'),
    ).toBeTruthy();
  });

  it('ends an active press when the session disconnects', async () => {
    const turnControl = makeTurnControl();
    const { getByRole, rerender } = renderManual('listening', turnControl);
    await act(async () => {
      fireEvent.pointerDown(getByRole('button', { name: 'Hold to talk' }), {
        pointerId: 1,
      });
    });
    voiceResult = makeVoiceResult('idle', {
      turnMode: 'manual',
      turnControl,
    });
    rerender(<ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />);
    expect(turnControl.endTurn).toHaveBeenCalledTimes(1);
  });

  it('hides hold-to-talk while automatic detection controls turns', () => {
    const { queryByRole } = renderManual('connected', makeTurnControl(), {
      turnMode: 'automatic',
    });
    expect(queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });
});

describe('ShopVoiceCorner playback recovery', () => {
  function renderLive(state: VoiceSessionState, switching = false) {
    voiceResult = makeVoiceResult(state, {
      provider: 'live',
      session: liveSession as ShopVoiceResult['session'],
      switching,
    });
    return render(<ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />);
  }

  it('unlocks GPT-Live playback from a click on Enable playback', () => {
    const { getByRole } = renderLive('connected');
    fireEvent.click(getByRole('button', { name: 'Enable playback' }));
    expect(activateAudio).toHaveBeenCalledTimes(1);
  });

  it.each([
    'idle',
    'connecting',
    'error',
  ] as const)('omits Enable playback while %s on GPT-Live', (state) => {
    const { queryByRole } = renderLive(state);
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
  });

  it('renders no actions container when no control is visible', () => {
    const { container } = renderLive('idle');
    expect(container.querySelector('.shop-voice-actions')).toBeNull();
  });

  it('renders the actions container once playback is available', () => {
    const { container } = renderLive('connected');
    expect(container.querySelector('.shop-voice-actions')).not.toBeNull();
  });

  it('disables Enable playback while the provider switches', () => {
    const { getByRole } = renderLive('connected', true);
    const button = getByRole('button', { name: 'Enable playback' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('omits Enable playback for OpenAI Realtime', () => {
    voiceResult = makeVoiceResult('connected', { provider: 'realtime' });
    const { queryByRole } = render(
      <ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />,
    );
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
  });
});
