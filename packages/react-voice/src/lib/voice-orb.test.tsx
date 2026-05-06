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

  it('calls stop() on click when silence (hot mic sub-state)', () => {
    const stopMock = mock(() => {});
    const startMock = mock(() => Promise.resolve());
    const VoiceOrb = createVoiceOrb(
      createMockUseVoice({ state: 'silence', stop: stopMock, start: startMock }),
    );
    const { container } = render(<VoiceOrb />);
    fireEvent.click(getButton(container));
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
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

  it('does not call start() on click when in error state', () => {
    const startMock = mock(() => Promise.resolve());
    const stopMock = mock(() => {});
    const interruptMock = mock(() => {});
    const VoiceOrb = createVoiceOrb(
      createMockUseVoice({
        state: 'error',
        start: startMock,
        stop: stopMock,
        interrupt: interruptMock,
      }),
    );
    const { container } = render(<VoiceOrb />);
    fireEvent.click(getButton(container));
    expect(startMock).not.toHaveBeenCalled();
    expect(stopMock).not.toHaveBeenCalled();
    expect(interruptMock).not.toHaveBeenCalled();
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

  it('shows "Speaking..." aria-label when state is speaking', () => {
    const VoiceOrb = createVoiceOrb(createMockUseVoice({ state: 'speaking' }));
    const { container } = render(<VoiceOrb />);
    expect(getButton(container).getAttribute('aria-label')).toBe('Speaking...');
  });

  it('shows "Voice error — click to retry" aria-label when state is error', () => {
    const VoiceOrb = createVoiceOrb(createMockUseVoice({ state: 'error' }));
    const { container } = render(<VoiceOrb />);
    expect(getButton(container).getAttribute('aria-label')).toBe(
      'Voice error — click to retry',
    );
  });

  it('injects the keyframes <style> exactly once across multiple orb mounts', () => {
    const useVoice = createMockUseVoice();
    const VoiceOrbA = createVoiceOrb(useVoice);
    const VoiceOrbB = createVoiceOrb(useVoice);

    render(<VoiceOrbA />);
    render(<VoiceOrbA />);
    render(<VoiceOrbB />);

    // Each createVoiceOrb factory has its own stylesInjected flag, but the
    // injected element is identified by `data-maelstrom="voice-orb"`. The
    // count we care about is the number of style tags actually attached to
    // the document — repeat mounts of the same factory must not re-inject.
    const styleTags = Array.from(document.head.getElementsByTagName('style')).filter(
      (s) => s.getAttribute('data-maelstrom') === 'voice-orb',
    );
    // Two factories, each injects once on first render → 2 tags total.
    // The point of this test is that re-rendering the same factory does NOT
    // push the count higher.
    expect(styleTags.length).toBe(2);
  });
});
