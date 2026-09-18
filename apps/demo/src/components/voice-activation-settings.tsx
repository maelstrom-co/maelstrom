import type { VoiceSessionState } from '@maelstrom-co/client';
import type { VoiceActivationConfig } from '@maelstrom-co/realtime';
import { useEffect, useId, useState } from 'react';

/** Stopped-only editor of the session's policy; drafts never alter running voice. */
interface VoiceActivationSettingsProps {
  /** Actual connection lifecycle, which takes precedence over waiting policy. */
  readonly state: VoiceSessionState;
  /** Validated shared settings, reflected when another consumer changes them. */
  readonly config: VoiceActivationConfig;
  /** Session-owned validation and mutation; may throw without accepting the draft. */
  readonly configure: (config: VoiceActivationConfig) => void;
  /** Retains accepted settings across a demo credential remount, if supplied. */
  readonly onConfigured?: (config: VoiceActivationConfig) => void;
}

/**
 * Accessible voice-only settings in an out-of-flow panel so opening it does not
 * resize the Chart. Normal is default; the opt-in preset is `hello maelstrom`,
 * 10 seconds after full-turn completion, and chat participation off. Validation
 * belongs to the session; stopped lifecycle is checked again at submission.
 */
export function VoiceActivationSettings({
  state,
  config,
  configure,
  onConfigured,
}: VoiceActivationSettingsProps) {
  const id = useId();
  const [mode, setMode] = useState(config.mode);
  const [phrase, setPhrase] = useState('hello maelstrom');
  const [seconds, setSeconds] = useState('10');
  const [chat, setChat] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const locked = state !== 'idle' && state !== 'error';
  useEffect(() => {
    setMode(config.mode);
    if (config.mode === 'trigger') {
      setPhrase(config.phrase);
      setSeconds(String((config.inactivityMs ?? 10000) / 1000));
      setChat(config.includeChatActivity ?? false);
    }
    setInvalid(false);
  }, [config]);

  return (
    <details className="relative shrink-0 text-xs text-ink-2">
      <summary className="status-pill cursor-pointer rounded-full px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent">
        Voice settings
      </summary>
      <div className="absolute bottom-full right-0 z-50 mb-2 w-80 max-w-[90vw] max-h-[70vh] overflow-auto rounded-xl border border-line bg-bg-1 p-4 shadow-xl">
        <p id={`${id}-privacy`} className="mb-3">
          While waiting, the microphone stays on and speech can reach provider
          STT (speech-to-text), incurring usage costs. Waiting is not mute or
          provider data erasure.
        </p>
        <p id={`${id}-lock`} className="mb-3">
          {locked
            ? 'Stop voice to change settings.'
            : 'Apply settings before starting voice.'}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (locked) return;
            const next: VoiceActivationConfig =
              mode === 'normal'
                ? { mode }
                : {
                    ...(config.mode === 'trigger' ? config : {}),
                    mode,
                    phrase,
                    inactivityMs: Number(seconds) * 1000,
                    includeChatActivity: chat,
                  };
            try {
              configure(next);
              setInvalid(false);
              onConfigured?.(next);
            } catch {
              setInvalid(true);
            }
          }}
        >
          <fieldset
            disabled={locked}
            aria-describedby={`${id}-lock ${id}-privacy`}
            className="flex flex-col gap-3 disabled:opacity-60"
          >
            <legend className="sr-only">Voice activation settings</legend>
            <label>
              Voice activation
              <select
                className="block w-full bg-bg-2 p-2"
                value={mode}
                onChange={(event) =>
                  setMode(
                    event.target.value === 'trigger' ? 'trigger' : 'normal',
                  )
                }
              >
                <option value="normal">Normal</option>
                <option value="trigger">Trigger phrase</option>
              </select>
            </label>
            {mode === 'trigger' && (
              <>
                <label>
                  Trigger phrase
                  <input
                    className="block w-full bg-bg-2 p-2"
                    value={phrase}
                    onChange={(event) => setPhrase(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Inactivity seconds
                  <input
                    className="block w-full bg-bg-2 p-2"
                    type="number"
                    min="1"
                    max="600"
                    step="0.001"
                    required
                    value={seconds}
                    onChange={(event) => setSeconds(event.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={chat}
                    onChange={(event) => setChat(event.target.checked)}
                  />{' '}
                  Include typed chat activity
                </label>
                <p>
                  Say the phrase alone, then a separate request. No greeting
                  plays on wake. Typed chat never wakes waiting voice.
                </p>
              </>
            )}
            <button className="btn btn-primary min-h-11" type="submit">
              Apply settings
            </button>
          </fieldset>
          {invalid && (
            <p role="alert">
              Stop voice first. Use a phrase with words, at most 200 Unicode
              characters, and a duration of 1–600 seconds in whole milliseconds.
            </p>
          )}
        </form>
      </div>
    </details>
  );
}
