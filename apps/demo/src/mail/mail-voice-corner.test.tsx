// @vitest-environment happy-dom

import type { VoiceSessionState } from '@maelstrom-co/client';
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_VOICE_OBSERVATIONS } from '../lib/__tests__/fake-realtime-session';

let voiceResult: UseVoiceResult;
const orbClick = vi.fn();
const prepareBrowserOpenAIVoice = vi.fn(() => true);

vi.doMock('./maelstrom', () => ({
  mailM: {
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

const { MailVoiceCorner, voicePillLabel } = await import('./mail-voice-corner');

function makeVoiceResult(state: VoiceSessionState): UseVoiceResult {
  return { state } as UseVoiceResult;
}

function renderCorner(state: VoiceSessionState, needsKey = false) {
  voiceResult = makeVoiceResult(state);
  const onRequireKey = vi.fn();
  const utils = render(
    <MailVoiceCorner needsKey={needsKey} onRequireKey={onRequireKey} />,
  );
  return { ...utils, onRequireKey };
}

beforeEach(() => {
  orbClick.mockClear();
  prepareBrowserOpenAIVoice.mockClear();
});

afterEach(cleanup);

describe('MailVoiceCorner', () => {
  it('renders the orb', () => {
    const { getByTestId } = renderCorner('idle');
    expect(getByTestId('voice-orb').className).toBe('mail-voice-orb');
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
    expect(getByRole('status').textContent).toBe(label);
    expect(voicePillLabel(state)).toBe(label);
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
