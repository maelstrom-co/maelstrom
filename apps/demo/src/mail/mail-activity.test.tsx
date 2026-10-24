// @vitest-environment happy-dom

import type { VoiceSessionState } from '@maelstrom-co/client';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let isProcessing = false;
let voiceState: VoiceSessionState = 'idle';
let touched: ReadonlySet<string> = new Set();

vi.doMock('./maelstrom', () => ({
  mailM: {
    useMaelstrom: (select: (state: { isProcessing: boolean }) => boolean) =>
      select({ isProcessing }),
    useVoice: () => ({ state: voiceState }),
    useTouchedInstances: () => touched,
  },
}));

const { MailActionFlash, useMailWorking } = await import('./mail-activity');

function WorkingProbe() {
  return <span data-testid="probe">{String(useMailWorking())}</span>;
}

function renderWorking(processing: boolean, state: VoiceSessionState) {
  isProcessing = processing;
  voiceState = state;
  return render(<WorkingProbe />).getByTestId('probe').textContent;
}

afterEach(() => {
  cleanup();
  isProcessing = false;
  voiceState = 'idle';
  touched = new Set();
});

describe('useMailWorking', () => {
  it('is idle when nothing is in flight', () => {
    expect(renderWorking(false, 'listening')).toBe('false');
  });

  it('is working while a typed request is processing', () => {
    expect(renderWorking(true, 'idle')).toBe('true');
  });

  it('is working while the voice assistant is thinking', () => {
    expect(renderWorking(false, 'thinking')).toBe('true');
  });
});

describe('MailActionFlash', () => {
  it('flags the vessels the assistant just changed', () => {
    touched = new Set(['message-main']);
    const { container } = render(
      <>
        <div data-instance-id="inbox-main" />
        <div data-instance-id="message-main" />
        <MailActionFlash />
      </>,
    );

    const flagged = [...container.querySelectorAll('[data-flash="true"]')];
    expect(
      flagged.map((node) => node.getAttribute('data-instance-id')),
    ).toEqual(['message-main']);
  });
});
