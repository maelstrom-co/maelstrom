import type { TranscriptEntry } from '@maelstrom-co/client';
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { m } from '../lib/maelstrom';

/** How long a finalized caption stays fully visible before it starts to fade. */
const FADE_DELAY_MS = 3500;

interface FadingCaption {
  readonly text: string;
  readonly faded: boolean;
}

// Fades on a plain setTimeout keyed off the entry's finalization timestamp
// rather than an rAF loop polling elapsed time — the transcript only changes
// a handful of times per utterance, so there is nothing to sample every
// frame for.
function useFadingCaption(
  entry: TranscriptEntry | undefined,
): FadingCaption | undefined {
  const [finalizedAt, setFinalizedAt] = useState<number | null>(null);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setFaded(false);
    setFinalizedAt(entry.final ? Date.now() : null);
  }, [entry]);

  useEffect(() => {
    if (finalizedAt === null) return;
    const timeoutId = setTimeout(() => setFaded(true), FADE_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [finalizedAt]);

  if (!entry) return undefined;
  return { text: entry.text, faded };
}

/**
 * Live voice captions in the footer chrome, above the orb and intent input.
 * Streaming fragments render as they arrive; a finalized line stays put for
 * a few seconds and then fades rather than disappearing abruptly.
 *
 * Always mounts a fixed-height band so showing or hiding captions cannot
 * resize the chart (and fire engine `chart_resize`). Each side is single-line
 * truncated and omitted when empty so one speaker does not claim half the row.
 */
export function Captions() {
  const { state, userTranscript, assistantTranscript } = m.useVoice();
  const assistant = useFadingCaption(assistantTranscript);
  const user = useFadingCaption(userTranscript);

  const voiceLive = state !== 'idle' && state !== 'error';
  // Empty/whitespace entries still produce a FadingCaption object — do not
  // render a lone accent dot or blank paragraph for those. Keep the truthy
  // object check first so TS narrows inside each branch.
  const showAssistant =
    voiceLive && assistant !== undefined && assistant.text.trim().length > 0;
  const showUser =
    voiceLive && user !== undefined && user.text.trim().length > 0;

  return (
    <div
      data-testid="captions"
      className="mx-auto mb-3 flex h-5 w-full max-w-4xl items-center justify-between gap-4"
    >
      {showAssistant && assistant ? (
        <p
          data-role="assistant"
          data-faded={Boolean(assistant.faded)}
          className={cn(
            'caption-line flex min-w-0 max-w-[50%] items-center gap-2 text-sm font-medium text-ink',
            assistant.faded && 'caption-line--faded',
          )}
        >
          <span
            className="caption-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-2"
            style={{ boxShadow: '0 0 8px var(--color-brand-2)' }}
          />
          <span className="truncate">{assistant.text}</span>
        </p>
      ) : null}
      {showUser && user ? (
        <p
          data-role="user"
          data-faded={Boolean(user.faded)}
          className={cn(
            'caption-line ml-auto min-w-0 max-w-[50%] truncate text-right text-sm text-ink-3',
            user.faded && 'caption-line--faded',
          )}
        >
          {user.text}
        </p>
      ) : null}
    </div>
  );
}
