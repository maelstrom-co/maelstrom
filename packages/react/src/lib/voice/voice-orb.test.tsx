import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createVoiceOrb } from './voice-orb.js';
import type { UseVoiceReturn, VoiceSessionState } from './use-voice-types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockUseVoice(overrides: Partial<UseVoiceReturn> = {}) {
  const defaults: UseVoiceReturn = {
    state: 'idle' as VoiceSessionState,
    isReady: true,
    isVoiceSupported: true,
    start: mock(() => Promise.resolve()),
    stop: mock(() => {}),
    interrupt: mock(() => {}),
    prepareAudio: mock(() => Promise.resolve()),
  };
  const merged = { ...defaults, ...overrides };
  return () => merged;
}

function getButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.firstElementChild as HTMLButtonElement | null;
  if (!btn || btn.tagName !== 'BUTTON') throw new Error('Expected a button element');
  return btn;
}

afterEach(() => cleanup());

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('VoiceOrb', () => {
  it('renders a button element', () => {
    const VoiceOrb = createVoiceOrb(createMockUseVoice());
    const { container } = render(<VoiceOrb />);
    expect(getButton(container)).toBeDefined();
  });

  it('shows "Click to start listening" aria-label when idle', () => {
    const VoiceOrb = createVoiceOrb(createMockUseVoice({ state: 'idle' }));
    const { container } = render(<VoiceOrb />);
    expect(getButton(container).getAttribute('aria-label')).toBe(
      'Click to start listening',
    );
  });

  it('shows "Listening... Click to stop" when state is listening', () => {
    const VoiceOrb = createVoiceOrb(createMockUseVoice({ state: 'listening' }));
    const { container } = render(<VoiceOrb />);
    expect(getButton(container).getAttribute('aria-label')).toBe(
      'Listening... Click to stop',
    );
  });

  it('shows "Processing..." when state is silence (mapped to processing)', () => {
    const VoiceOrb = createVoiceOrb(createMockUseVoice({ state: 'silence' }));
    const { container } = render(<VoiceOrb />);
    expect(getButton(container).getAttribute('aria-label')).toBe('Processing...');
  });

  it('calls start() on click when idle', () => {
    const startMock = mock(() => Promise.resolve());
    const VoiceOrb = createVoiceOrb(createMockUseVoice({ state: 'idle', start: startMock }));
    const { container } = render(<VoiceOrb />);
    fireEvent.click(getButton(container));
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('calls stop() on click when listening', () => {
    const stopMock = mock(() => {});
    const VoiceOrb = createVoiceOrb(
      createMockUseVoice({ state: 'listening', stop: stopMock }),
    );
    const { container } = render(<VoiceOrb />);
    fireEvent.click(getButton(container));
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it('calls interrupt() on click when speaking', () => {
    const interruptMock = mock(() => {});
    const VoiceOrb = createVoiceOrb(
      createMockUseVoice({ state: 'speaking', interrupt: interruptMock }),
    );
    const { container } = render(<VoiceOrb />);
    fireEvent.click(getButton(container));
    expect(interruptMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when isVoiceSupported is false', () => {
    const VoiceOrb = createVoiceOrb(
      createMockUseVoice({ isVoiceSupported: false }),
    );
    const { container } = render(<VoiceOrb />);
    expect(container.innerHTML).toBe('');
  });

  it('button is disabled when isReady is false', () => {
    const VoiceOrb = createVoiceOrb(createMockUseVoice({ isReady: false }));
    const { container } = render(<VoiceOrb />);
    expect(getButton(container).hasAttribute('disabled')).toBe(true);
  });
});
