// @vitest-environment happy-dom
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';
import type { VoiceActivationConfig } from '@maelstrom-co/realtime';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceActivationSettings } from './voice-activation-settings';

let voice: UseVoiceResult;
vi.mock('../lib/maelstrom', () => ({
  m: { useVoice: () => voice, VoiceOrb: () => null },
}));
const { VoiceControl } = await import('./voice-control');
afterEach(cleanup);

describe('voice activation settings', () => {
  it('starts normal with chat off and keyboard-labelled opt-in fields', () => {
    const configure = vi.fn();
    const ui = render(
      <VoiceActivationSettings
        state="idle"
        config={{ mode: 'normal' }}
        configure={configure}
      />,
    );
    fireEvent.click(ui.getByText('Voice settings'));
    const mode = ui.getByLabelText('Voice activation');
    if (!(mode instanceof HTMLSelectElement))
      throw new Error('Expected select');
    expect(mode.value).toBe('normal');
    fireEvent.change(mode, { target: { value: 'trigger' } });
    expect(
      (ui.getByLabelText('Trigger phrase') as HTMLInputElement).value,
    ).toBe('hello maelstrom');
    expect(
      (ui.getByLabelText('Inactivity seconds') as HTMLInputElement).value,
    ).toBe('10');
    expect(
      (ui.getByLabelText('Include typed chat activity') as HTMLInputElement)
        .checked,
    ).toBe(false);
    fireEvent.click(ui.getByLabelText('Include typed chat activity'));
    const save = ui.getByRole('button', { name: 'Apply settings' });
    save.focus();
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(save, { key: 'Enter' });
    fireEvent.click(save);
    fireEvent.submit(save.closest('form')!);
    expect(configure).toHaveBeenCalledWith({
      mode: 'trigger',
      phrase: 'hello maelstrom',
      inactivityMs: 10000,
      includeChatActivity: true,
    });
    expect(ui.getByText(/microphone.*provider.*usage/i)).toBeTruthy();
  });

  it('shows validation failures without accepting a draft, then recovers', () => {
    const config: VoiceActivationConfig = {
      mode: 'trigger',
      phrase: 'hello maelstrom',
    };
    const configure = vi.fn((next: VoiceActivationConfig) => {
      if (next.mode === 'trigger' && next.phrase === '!!!')
        throw new Error('private diagnostic');
    });
    const ui = render(
      <VoiceActivationSettings
        state="error"
        config={config}
        configure={configure}
      />,
    );
    fireEvent.click(ui.getByText('Voice settings'));
    fireEvent.change(ui.getByLabelText('Trigger phrase'), {
      target: { value: '!!!' },
    });
    fireEvent.click(ui.getByRole('button', { name: 'Apply settings' }));
    fireEvent.submit(
      ui.getByRole('button', { name: 'Apply settings' }).closest('form')!,
    );
    expect(ui.getByRole('alert').textContent).toContain('200');
    expect(ui.queryByText('private diagnostic')).toBeNull();
    fireEvent.change(ui.getByLabelText('Trigger phrase'), {
      target: { value: 'hello again' },
    });
    fireEvent.click(ui.getByRole('button', { name: 'Apply settings' }));
    fireEvent.submit(
      ui.getByRole('button', { name: 'Apply settings' }).closest('form')!,
    );
    expect(ui.queryByRole('alert')).toBeNull();
  });

  it.each([
    'connecting',
    'connected',
    'listening',
    'thinking',
    'speaking',
  ] as const)('locks all settings while %s', (state) => {
    const configure = vi.fn();
    const ui = render(
      <VoiceActivationSettings
        state={state}
        config={{ mode: 'trigger', phrase: 'hello' }}
        configure={configure}
      />,
    );
    fireEvent.click(ui.getByText('Voice settings'));
    expect(ui.getByText('Stop voice to change settings.')).toBeTruthy();
    expect(
      ui
        .getByRole('group', { name: 'Voice activation settings' })
        .hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.submit(
      ui.getByRole('button', { name: 'Apply settings' }).closest('form')!,
    );
    expect(configure).not.toHaveBeenCalled();
  });

  it.each([
    ['idle', 'waiting', 'Voice off'],
    ['error', 'waiting', 'Voice error'],
    ['connecting', 'waiting', 'Connecting…'],
    ['connected', 'waiting', 'Waiting for trigger'],
    ['connected', 'activating', 'Activating…'],
    ['connected', 'active', 'Voice active'],
    ['speaking', 'active', 'Speaking…'],
    ['connected', 'deactivating', 'Returning to waiting…'],
  ] as const)('labels %s before policy %s', (state, activationState, label) => {
    voice = {
      state,
      activationState,
      activationConfig: { mode: 'trigger', phrase: 'hello' },
      greetingState: 'pending',
      turnMode: 'automatic',
    } as UseVoiceResult;
    const ui = render(<VoiceControl showOrb={false} />);
    expect(ui.getByRole('status').textContent).toBe(label);
  });
});
