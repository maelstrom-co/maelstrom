// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { voiceProviderStore } from '../lib/voice-provider';
import { ShopKeylessPreview } from './shop-keyless-preview';

afterEach(() => {
  cleanup();
  voiceProviderStore.setState(() => ({ provider: 'live' }));
});

function renderPreview() {
  return render(
    <ShopKeylessPreview
      intent=""
      onIntentChange={vi.fn()}
      onRequireKey={vi.fn()}
      onBlockedSubmit={vi.fn()}
    />,
  );
}

function optionLabels(picker: HTMLElement): (string | null)[] {
  return Array.from(
    picker.querySelectorAll('option'),
    (option) => option.textContent,
  );
}

describe('ShopKeylessPreview voice picker', () => {
  it('offers only GPT-Live and OpenAI Realtime', () => {
    const { getByRole } = renderPreview();
    const picker = getByRole('combobox', {
      name: 'Voice provider',
    });
    expect(optionLabels(picker)).toEqual(['GPT-Live', 'OpenAI Realtime']);
    expect(
      getByRole('option', { name: 'GPT-Live', selected: true }),
    ).toBeTruthy();
  });

  it('stores the chosen provider for the session the key starts', () => {
    const { getByRole } = renderPreview();
    fireEvent.change(getByRole('combobox', { name: 'Voice provider' }), {
      target: { value: 'realtime' },
    });
    expect(voiceProviderStore.state.provider).toBe('realtime');
    expect(
      getByRole('option', { name: 'OpenAI Realtime', selected: true }),
    ).toBeTruthy();
  });

  it('shows GPT-Live when the stored choice is LiveKit', () => {
    voiceProviderStore.setState(() => ({ provider: 'livekit' }));
    const { getByRole } = renderPreview();
    const picker = getByRole('combobox', {
      name: 'Voice provider',
    });
    expect(optionLabels(picker)).toEqual(['GPT-Live', 'OpenAI Realtime']);
    expect(
      getByRole('option', { name: 'GPT-Live', selected: true }),
    ).toBeTruthy();
  });
});
