// PROTOTYPE (MAE-825): throwaway agent loop, never merge.

/** The server's first-turn placeholder progress text. */
export const AGENT_PLACEHOLDER_CUE = 'Working on it…';

/** Cues spoken closer together than this are dropped. */
export const MIN_CUE_GAP_MS = 2500;

/** How long the placeholder waits for a real cue that replaces it. */
export const PLACEHOLDER_HOLD_MS = 1500;

/** Throttles one voice turn's progress cues; `close` silences it for good. */
export interface VoiceCueGate {
  /** Offers one `agent.progress` text for speech. */
  offer(text: string): void;
  /** Ends the turn: drops a held placeholder and ignores later offers. */
  close(): void;
}

/**
 * Creates the cue policy for one voice-originated Agent Session turn: the
 * placeholder is held briefly and dropped if a real cue follows, cues within
 * {@link MIN_CUE_GAP_MS} of the last spoken one and repeats are skipped, and
 * nothing is spoken after `close`.
 */
export function createVoiceCueGate(options: {
  readonly speak: (text: string) => boolean;
  readonly now?: () => number;
  readonly log?: (message: string, text: string) => void;
}): VoiceCueGate {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  let closed = false;
  let lastSpokenAt: number | undefined;
  let lastText: string | undefined;
  let held: ReturnType<typeof setTimeout> | undefined;

  const speak = (text: string) => {
    if (closed) return;
    const at = now();
    if (text === lastText) {
      log('skipped repeated cue', text);
      return;
    }
    if (lastSpokenAt !== undefined && at - lastSpokenAt < MIN_CUE_GAP_MS) {
      log('skipped cue inside the gap', text);
      return;
    }
    const sent = options.speak(text);
    log(sent ? 'speaking cue' : 'adapter skipped cue', text);
    if (!sent) return;
    lastSpokenAt = at;
    lastText = text;
  };

  return {
    offer(raw) {
      const text = raw.trim();
      if (closed || !text) return;
      if (text === AGENT_PLACEHOLDER_CUE) {
        if (held === undefined)
          held = setTimeout(() => {
            held = undefined;
            speak(text);
          }, PLACEHOLDER_HOLD_MS);
        return;
      }
      if (held !== undefined) {
        clearTimeout(held);
        held = undefined;
        log('dropped placeholder for a real cue', AGENT_PLACEHOLDER_CUE);
      }
      speak(text);
    },
    close() {
      closed = true;
      if (held !== undefined) clearTimeout(held);
      held = undefined;
    },
  };
}
