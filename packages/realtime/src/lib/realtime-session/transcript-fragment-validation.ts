import type { TimedTranscriptFragment } from '@maelstrom-co/client';

/** Default upper bound on one fragment's text, in characters. */
export const DEFAULT_MAX_FRAGMENT_CHARS = 16384;

/**
 * Shared acceptance rule for adapter transcript fragments, so every session
 * event subscriber accepts exactly the same evidence.
 */
export function isValidFragment(
  fragment: TimedTranscriptFragment,
  maxFragmentChars: number = DEFAULT_MAX_FRAGMENT_CHARS,
): boolean {
  return (
    Boolean(fragment.id) &&
    fragment.id.length <= 256 &&
    Boolean(fragment.speakerId) &&
    fragment.speakerId.length <= 256 &&
    Number.isFinite(fragment.startMs) &&
    Number.isFinite(fragment.endMs) &&
    fragment.startMs >= 0 &&
    fragment.endMs >= fragment.startMs &&
    fragment.text.length <= maxFragmentChars
  );
}
