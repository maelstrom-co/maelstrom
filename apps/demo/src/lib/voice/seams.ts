// Seam types for the liveKitVoice extension.
// Phase 1: only onTranscript is active. onResponse is a stub (Phase 2).

import type { Orchestrator } from '@maelstrom-co/client';

export interface VoiceSeams {
  /** Called when the agent emits a final transcript. Default: orchestrator.processIntent */
  onTranscript: (text: string) => unknown;
  /** Called when the orchestrator applies a response. Default: noop (Phase 2). */
  onResponse: (userMessage: string) => unknown;
}

export function defaultSeams(orchestrator: Orchestrator): VoiceSeams {
  return {
    onTranscript: (text) => orchestrator.processIntent(text),
    onResponse: () => {},
  };
}
