// OpenAI doesn't document a settled event catalog for gpt-realtime-2, so this
// allowlist exists to separate "known-benign, intentionally unmapped" traffic
// from genuine shape drift — without it, every session/response bookkeeping
// event the adapter doesn't care about would warn, drowning out real drift.
const KNOWN_BENIGN_UNMAPPED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'session.created',
  'session.updated',
  'response.created',
  'response.done',
  'response.cancelled',
  'response.output_item.added',
  'response.output_item.done',
  'response.content_part.added',
  'response.content_part.done',
  'response.function_call_arguments.delta',
  'response.audio.delta',
  'response.audio.done',
  'response.output_audio.delta',
  'response.output_audio.done',
  'response.text.delta',
  'response.text.done',
  'output_audio_buffer.started',
  'output_audio_buffer.stopped',
  'output_audio_buffer.cleared',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.committed',
  'conversation.item.created',
  'conversation.item.added',
  'conversation.item.done',
  'conversation.item.deleted',
  'rate_limits.updated',
]);

function isKnownBenignUnmappedEventType(type: string): boolean {
  return KNOWN_BENIGN_UNMAPPED_EVENT_TYPES.has(type);
}

export interface UnexpectedEventTracker {
  /** Returns a fixed known event type, or `undefined` for provider-controlled input. */
  knownType(type: string | undefined): string | undefined;
  /** Records one occurrence of `type`. Returns `true` on its first sighting (warn), `false` otherwise. */
  track(type: string): boolean;
  /** Occurrence counts for every unexpected type seen so far. */
  snapshot(): ReadonlyMap<string, number>;
}

export function createUnexpectedEventTracker(): UnexpectedEventTracker {
  const counts = new Map<string, number>();

  return {
    knownType(type: string | undefined): string | undefined {
      return type !== undefined && isKnownBenignUnmappedEventType(type)
        ? type
        : undefined;
    },
    track(type: string): boolean {
      if (isKnownBenignUnmappedEventType(type)) return false;
      const seenBefore = counts.has(type);
      counts.set(type, (counts.get(type) ?? 0) + 1);
      return !seenBefore;
    },
    snapshot(): ReadonlyMap<string, number> {
      return new Map(counts);
    },
  };
}
