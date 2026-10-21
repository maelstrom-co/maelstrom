// @vitest-environment happy-dom

import type { VoiceCaption, VoiceSessionState } from '@maelstrom-co/client';
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_VOICE_OBSERVATIONS } from '../lib/__tests__/fake-realtime-session';

let voiceResult: UseVoiceResult;
let captions: readonly VoiceCaption[] = [];
let generation = 1;

vi.doMock('./maelstrom', () => ({
  mailM: {
    useVoice: () => voiceResult,
    useVoiceObservations: () => ({
      snapshot: { ...EMPTY_VOICE_OBSERVATIONS, generation, captions },
    }),
  },
}));

const { MailCaption } = await import('./mail-caption');

function makeCaption(overrides: Partial<VoiceCaption> = {}): VoiceCaption {
  return {
    id: 'user-1',
    speakerId: 'user',
    role: 'user',
    text: 'Show my unread mail',
    final: true,
    fragmentIds: ['f1'],
    startMs: 0,
    endMs: 100,
    ...overrides,
  };
}

function renderCaption(
  state: VoiceSessionState,
  nextCaptions: readonly VoiceCaption[],
) {
  voiceResult = { state } as UseVoiceResult;
  captions = nextCaptions;
  generation = 1;
  return render(<MailCaption />);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const line = (container: HTMLElement) =>
  container.querySelector('.mail-caption-line');

describe('MailCaption', () => {
  it('keeps the band mounted while idle', () => {
    const { getByTestId, container } = renderCaption('idle', []);
    expect(getByTestId('mail-caption')).toBeTruthy();
    expect(line(container)).toBeNull();
  });

  it('shows only the latest user line and never assistant captions', () => {
    const { container } = renderCaption('listening', [
      makeCaption({ id: 'u1', text: 'First question' }),
      makeCaption({
        id: 'a1',
        role: 'assistant',
        speakerId: 'assistant',
        text: 'Assistant words',
      }),
      makeCaption({ id: 'u2', text: 'Second question' }),
    ]);
    const lines = container.querySelectorAll('.mail-caption-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toBe('Second question');
    expect(container.textContent).not.toContain('Assistant words');
  });

  it('renders nothing for assistant-only captions', () => {
    const { container } = renderCaption('speaking', [
      makeCaption({ role: 'assistant', speakerId: 'assistant' }),
    ]);
    expect(line(container)).toBeNull();
  });

  it.each(['idle', 'error'] as const)('hides the line in %s', (state) => {
    const { container, getByTestId } = renderCaption(state, [makeCaption()]);
    expect(line(container)).toBeNull();
    expect(getByTestId('mail-caption')).toBeTruthy();
  });

  it('renders nothing for blank text', () => {
    const { container } = renderCaption('listening', [
      makeCaption({ text: '   ' }),
    ]);
    expect(line(container)).toBeNull();
  });

  it('fades a finalized line after 3s but not at 2.9s', async () => {
    vi.useFakeTimers();
    const { container } = renderCaption('listening', [makeCaption()]);
    expect(line(container)?.getAttribute('data-faded')).toBe('false');
    await act(async () => {
      vi.advanceTimersByTime(2900);
    });
    expect(line(container)?.getAttribute('data-faded')).toBe('false');
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(line(container)?.getAttribute('data-faded')).toBe('true');
  });

  it('never fades a line that is still streaming', async () => {
    vi.useFakeTimers();
    const { container } = renderCaption('listening', [
      makeCaption({ final: false }),
    ]);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(line(container)?.getAttribute('data-faded')).toBe('false');
  });
});
