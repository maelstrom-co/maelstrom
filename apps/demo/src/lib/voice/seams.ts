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

/** Predicate deciding whether a completed response should be spoken. */
export type ShouldSpeak = (response: MaelstromResponse) => boolean;

export interface VoiceSeams {
  /** Called when the agent emits a final transcript. Default: orchestrator.processIntent */
  onTranscript: (text: string) => void | Promise<void>;
  /**
   * Called when the orchestrator finishes applying a response (read-only
   * observation — does NOT alter response application). Default: speak the
   * response's userMessage via the `speak` transport when `shouldSpeak` passes.
   */
  onResponse: (response: MaelstromResponse) => void | Promise<void>;
}

export function defaultShouldSpeak(response: MaelstromResponse): boolean {
  return response.userMessage.trim().length > 0;
}

/**
 * Builds the default `onResponse` seam: speak a completed response's
 * userMessage when `shouldSpeak` passes. `shouldSpeak` lives here as a builder
 * argument (not a dangling sibling option) so its coupling to the default seam
 * is structural — a caller that replaces `onResponse` wholesale doesn't inherit
 * a `shouldSpeak` that silently does nothing.
 */
export function speakBackOnResponse(
  speak: SpeakTransport,
  shouldSpeak: ShouldSpeak = defaultShouldSpeak,
): VoiceSeams['onResponse'] {
  return (response) => {
    if (!shouldSpeak(response)) return;
    return speak(response.userMessage);
  };
}

export function defaultSeams(
  orchestrator: Orchestrator,
  speak: SpeakTransport,
  shouldSpeak: ShouldSpeak = defaultShouldSpeak,
): VoiceSeams {
  return {
    onTranscript: async (text) => {
      await orchestrator.processIntent(text);
    },
    onResponse: speakBackOnResponse(speak, shouldSpeak),
  };
}
