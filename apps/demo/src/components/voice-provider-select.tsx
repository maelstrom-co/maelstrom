import { useStore } from '@tanstack/react-store';
import { useEffect, useState } from 'react';
import {
  type DemoVoiceProvider,
  selectVoiceProvider,
  voiceProviderStore,
} from '../lib/voice-provider';

const PROVIDER_LABELS: Record<DemoVoiceProvider, string> = {
  live: 'GPT-Live',
  realtime: 'OpenAI Realtime',
  livekit: 'LiveKit',
};

interface VoiceProviderSwitch<Provider extends DemoVoiceProvider> {
  readonly provider: Provider;
  readonly switching: boolean;
  readonly switchProvider: (provider: Provider) => Promise<void>;
}

export function KeylessVoiceProviderSelect({
  options,
}: {
  readonly options: readonly DemoVoiceProvider[];
}) {
  const provider = useStore(voiceProviderStore, (state) => state.provider);
  return (
    <ProviderSelect
      options={options}
      value={provider}
      onChange={selectVoiceProvider}
    />
  );
}

export function VoiceProviderSelect<Provider extends DemoVoiceProvider>({
  useVoice,
  options,
}: {
  readonly useVoice: () => VoiceProviderSwitch<Provider>;
  readonly options: readonly Provider[];
}) {
  const { provider, switching, switchProvider } = useVoice();
  const [switchFailed, setSwitchFailed] = useState(false);
  // The keyless page and key-save remounts start from the stored choice.
  useEffect(() => selectVoiceProvider(provider), [provider]);
  return (
    <>
      <ProviderSelect
        options={options}
        value={provider}
        disabled={switching}
        onChange={(next) => {
          setSwitchFailed(false);
          void switchProvider(next).catch(() => setSwitchFailed(true));
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

// A stored choice outside the offered list shows as the first option, which
// is the provider a session started from that choice falls back to.
function ProviderSelect<Provider extends DemoVoiceProvider>({
  options,
  value,
  disabled,
  onChange,
}: {
  readonly options: readonly Provider[];
  readonly value: DemoVoiceProvider;
  readonly disabled?: boolean;
  readonly onChange: (value: Provider) => void;
}) {
  const selected = options.find((option) => option === value) ?? options[0];
  return (
    <label className="flex items-center gap-2 text-xs text-ink-2">
      <span className="voice-provider-label">Voice</span>
      <select
        aria-label="Voice provider"
        className="status-pill min-h-11 rounded-full bg-bg-1 px-3 text-ink"
        value={selected}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find((option) => option === event.target.value);
          if (next !== undefined) onChange(next);
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {PROVIDER_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
