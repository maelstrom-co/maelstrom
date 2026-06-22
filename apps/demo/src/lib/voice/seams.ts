// Seam types for the liveKitVoice extension.
//
// These two seams are the abstraction edge between Maelstrom and LiveKit:
//   - onTranscript: agent transcript → intent pipeline (default: processIntent)
//   - onResponse:   completed response → spoken reply (default: speak userMessage)
// Nothing in the extension bypasses them, so the future thick/realtime swap is
// "replace the seam body", not a rewrite.

import type { MaelstromResponse } from '@maelstrom-co/protocol';
import type { Orchestrator } from '@maelstrom-co/client';

/**
 * Sends text to the agent worker for TTS synthesis (over the `speak` text
 * stream). Provided by the extension at runtime; the default `onResponse`
 * routes through it. A no-op when voice is off (no room joined).
 */
export type SpeakTransport = (text: string) => Promise<void>;

/**
 * Decides whether a completed response should be spoken. Kept as a standalone
 * predicate (never an inlined `if` at the speak site) so granular toggling
 * later is "swap the predicate body", same call sites.
 */
export type ShouldSpeak = (response: MaelstromResponse) => boolean;

export interface VoiceSeams {
  /** Called when the agent emits a final transcript. Default: orchestrator.processIntent */
  onTranscript: (text: string) => unknown;
  /**
   * Called when the orchestrator finishes applying a response (read-only
   * observation — does NOT alter response application). Default: speak the
   * response's userMessage via the `speak` transport when `shouldSpeak` passes.
   */
  onResponse: (response: MaelstromResponse) => unknown;
}

/**
 * Global speak-back predicate: speak every userMessage when voice is on,
 * regardless of input modality (typed OR spoken). The degenerate case of the
 * future granular config — when granular lands, this body grows fields, the
 * call site in `onResponse` does not move.
 */
export function defaultShouldSpeak(response: MaelstromResponse): boolean {
  return response.userMessage.trim().length > 0;
}

export function defaultSeams(
  orchestrator: Orchestrator,
  speak: SpeakTransport,
  shouldSpeak: ShouldSpeak = defaultShouldSpeak,
): VoiceSeams {
  return {
    onTranscript: (text) => orchestrator.processIntent(text),
    onResponse: (response) => {
      if (!shouldSpeak(response)) return;
      return speak(response.userMessage);
    },
  };
}
