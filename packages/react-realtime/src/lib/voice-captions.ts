import type { VoiceCaption } from '@maelstrom-co/client';
import { useEffect, useState } from 'react';

import type {
  UseVoiceObservationsResult,
  UseVoiceResult,
} from './maelstrom-realtime.js';

/** Options for `useVoiceCaptions()`. */
export interface UseVoiceCaptionsOptions {
  /**
   * Milliseconds a caption stays fully visible after its last new fragment
   * before it reports `faded`. Streaming and final captions fade alike, so a
   * provider that never finalizes still clears its stale line.
   */
  readonly fadeDelayMs: number;
}

/** Latest caption for one role, ready to render. */
export interface FadingVoiceCaption {
  /** Caption text exactly as the observation store grouped it; may be blank. */
  readonly text: string;
  /**
   * True once `fadeDelayMs` passed with no new fragment for this caption. A new
   * fragment, a revised text, or a new caption identity resets it to false.
   */
  readonly faded: boolean;
}

/** Return value of `useVoiceCaptions()`. */
export interface UseVoiceCaptionsResult {
  /** Latest user caption; undefined while voice is idle or in error, or before any arrives. */
  readonly user: FadingVoiceCaption | undefined;
  /** Latest assistant caption; undefined while voice is idle or in error, or before any arrives. */
  readonly assistant: FadingVoiceCaption | undefined;
}

export function createUseVoiceCaptions(
  useVoice: () => Pick<UseVoiceResult<unknown>, 'state'>,
  useVoiceObservations: () => UseVoiceObservationsResult,
): (options: UseVoiceCaptionsOptions) => UseVoiceCaptionsResult {
  return ({ fadeDelayMs }) => {
    const { state } = useVoice();
    const { snapshot } = useVoiceObservations();
    const { captions, generation } = snapshot;
    const user = useFadingCaption(
      latestCaption(captions, 'user'),
      generation,
      fadeDelayMs,
    );
    const assistant = useFadingCaption(
      latestCaption(captions, 'assistant'),
      generation,
      fadeDelayMs,
    );
    if (state === 'idle' || state === 'error')
      return { user: undefined, assistant: undefined };
    return { user, assistant };
  };
}

// Caption groups are rebuilt on unrelated fragment updates, so the fade key is
// the caption's identity and text within its generation, never the object.
function useFadingCaption(
  caption: VoiceCaption | undefined,
  generation: number,
  fadeDelayMs: number,
): FadingVoiceCaption | undefined {
  const key =
    caption === undefined
      ? undefined
      : JSON.stringify([generation, caption.id, caption.text]);
  const [fadedKey, setFadedKey] = useState<string>();
  const [previousKey, setPreviousKey] = useState(key);
  if (previousKey !== key) {
    setPreviousKey(key);
    setFadedKey(undefined);
  }

  useEffect(() => {
    if (key === undefined) return;
    const timeoutId = setTimeout(() => setFadedKey(key), fadeDelayMs);
    return () => clearTimeout(timeoutId);
  }, [key, fadeDelayMs]);

  if (caption === undefined) return undefined;
  return { text: caption.text, faded: fadedKey === key };
}

function latestCaption(
  captions: readonly VoiceCaption[],
  role: VoiceCaption['role'],
): VoiceCaption | undefined {
  for (let index = captions.length - 1; index >= 0; index -= 1) {
    const caption = captions[index];
    if (caption?.role === role) return caption;
  }
  return undefined;
}
