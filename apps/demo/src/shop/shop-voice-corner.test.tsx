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

type LivePlayback = 'unavailable' | 'pending' | 'accepted' | 'blocked';

const activateAudio = vi.fn(async () => {});
let livePlayback: LivePlayback = 'accepted';
const playbackListeners = new Set<() => void>();
class FakeLiveAdapter {
  activateAudio = activateAudio;
  getTransportSnapshot() {
    return { playback: livePlayback };
  }
  generatedOpening = {
    readiness: {
      subscribe: (handler: () => void) => {
        playbackListeners.add(handler);
        return () => {
          playbackListeners.delete(handler);
        };
      },
    },
  };
}
const liveSession = {};
const liveAdapter = new FakeLiveAdapter();
vi.doMock('@maelstrom-co/realtime-openai-live', () => ({
  OpenAILiveAdapter: FakeLiveAdapter,
}));
vi.doMock('../lib/demo-voice', () => ({
  demoVoiceSession: (session: unknown) =>
    session === liveSession ? { adapter: liveAdapter } : undefined,
}));

function setLivePlayback(playback: LivePlayback) {
  livePlayback = playback;
  for (const listener of [...playbackListeners]) listener();
}

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
  livePlayback = 'accepted';
  playbackListeners.clear();
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

describe('ShopVoiceCorner playback recovery', () => {
  function renderLive(state: VoiceSessionState, switching = false) {
    voiceResult = makeVoiceResult(state, {
      provider: 'live',
      session: liveSession as ShopVoiceResult['session'],
      switching,
    });
    return render(<ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />);
  }

  it.each([
    'accepted',
    'pending',
    'unavailable',
  ] as const)('keeps the status pill while GPT-Live playback is %s', (playback) => {
    livePlayback = playback;
    const { getByRole, queryByRole } = renderLive('listening');
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
    expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
      'Listening',
    );
  });

  it('shows Enable playback in place of the pill while playback is blocked', () => {
    livePlayback = 'blocked';
    const { container, getByRole, queryByRole } = renderLive('listening');
    const button = getByRole('button', { name: 'Enable playback' });
    expect(queryByRole('status', { name: 'Voice status' })).toBeNull();
    expect(button.parentElement?.className).toBe('shop-voice-status');
    expect(container.querySelector('.shop-voice-actions')).toBeNull();
  });

  it('unlocks GPT-Live playback from a click on Enable playback', () => {
    livePlayback = 'blocked';
    const { getByRole } = renderLive('connected');
    fireEvent.click(getByRole('button', { name: 'Enable playback' }));
    expect(activateAudio).toHaveBeenCalledTimes(1);
  });

  it('brings the pill back once blocked playback is accepted', () => {
    livePlayback = 'blocked';
    const { getByRole, queryByRole } = renderLive('speaking');
    expect(getByRole('button', { name: 'Enable playback' })).toBeTruthy();
    act(() => setLivePlayback('accepted'));
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
    expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
      'Speaking',
    );
  });

  it('shows Enable playback when playback becomes blocked after render', () => {
    const { getByRole, queryByRole } = renderLive('listening');
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
    act(() => setLivePlayback('blocked'));
    expect(getByRole('button', { name: 'Enable playback' })).toBeTruthy();
  });

  it.each([
    'idle',
    'connecting',
    'error',
  ] as const)('keeps the pill while %s on GPT-Live', (state) => {
    livePlayback = 'blocked';
    const { getByRole, queryByRole } = renderLive(state);
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
    expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
      voicePillLabel(state),
    );
  });

  it('disables Enable playback while the provider switches', () => {
    livePlayback = 'blocked';
    const { getByRole } = renderLive('connected', true);
    const button = getByRole('button', { name: 'Enable playback' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('omits Enable playback for OpenAI Realtime', () => {
    livePlayback = 'blocked';
    voiceResult = makeVoiceResult('connected', { provider: 'realtime' });
    const { getByRole, queryByRole } = render(
      <ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />,
    );
    expect(queryByRole('button', { name: 'Enable playback' })).toBeNull();
    expect(getByRole('status', { name: 'Voice status' })).toBeTruthy();
  });
});

describe('ShopVoiceCorner turn controls', () => {
  it('never shows hold-to-talk, even in manual turn mode', () => {
    voiceResult = makeVoiceResult('connected', {
      turnMode: 'manual',
      turnControl: makeTurnControl(),
      turnModeError: new Error('vad failed'),
    });
    const { queryByRole, queryByText } = render(
      <ShopVoiceCorner needsKey={false} onRequireKey={vi.fn()} />,
    );
    expect(queryByRole('button', { name: 'Hold to talk' })).toBeNull();
    expect(
      queryByText('Automatic voice detection unavailable; hold to talk.'),
    ).toBeNull();
  });
});
