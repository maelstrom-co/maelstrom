import { useStore } from '@tanstack/react-store';
import { useState } from 'react';
import { isHosted } from '../lib/hosted-mode';
import { m } from '../lib/maelstrom';
import {
  type DemoVoiceProvider,
  selectVoiceProvider,
  voiceProviderStore,
} from '../lib/voice-provider';

function ProviderSelect({
  value,
  disabled,
  onChange,
}: {
  value: DemoVoiceProvider;
  disabled?: boolean;
  onChange: (value: DemoVoiceProvider) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-2">
      <span className="voice-provider-label">Voice</span>
      <select
        aria-label="Voice provider"
        className="status-pill min-h-11 rounded-full bg-bg-1 px-3 text-ink"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'live' || value === 'realtime' || value === 'livekit')
            onChange(value);
        }}
      >
        <option value="live">GPT-Live</option>
        <option value="realtime">OpenAI Realtime</option>
        {!isHosted() && <option value="livekit">LiveKit</option>}
      </select>
    </label>
  );
}

export function KeylessVoiceProviderSelect() {
  const provider = useStore(voiceProviderStore, (state) => state.provider);
  return <ProviderSelect value={provider} onChange={selectVoiceProvider} />;
}

export function VoiceProviderSelect() {
  const { owner, provider, switching } = m.useVoice();
  const [switchFailed, setSwitchFailed] = useState(false);
  return (
    <>
      <ProviderSelect
        value={provider}
        disabled={switching}
        onChange={(next) => {
          setSwitchFailed(false);
          void owner.select(next).catch(() => setSwitchFailed(true));
        }}
      />
      {switchFailed && (
        <span role="alert" className="text-xs text-pink">
          Could not switch voice provider. Try again.
        </span>
      )}
    </>
  );
}
