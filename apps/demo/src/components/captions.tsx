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
 * Live voice captions anchored to the chart's bottom edge, above the intent
 * input. Streaming fragments render as they arrive; a finalized line stays
 * put for a few seconds and then fades rather than disappearing abruptly.
 * Hidden entirely while voice is idle, errored, or has nothing to show yet.
 */
export function Captions() {
  const { state, userTranscript, assistantTranscript } = m.useVoice();
  const assistant = useFadingCaption(assistantTranscript);
  const user = useFadingCaption(userTranscript);

  if (state === 'idle' || state === 'error') return null;
  if (!assistant && !user) return null;

  return (
    <div
      data-testid="captions-overlay"
      className="captions-overlay pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-4 bg-gradient-to-t from-bg-1/90 via-bg-1/50 to-transparent px-6 pb-3 pt-10 backdrop-blur-sm"
    >
      <p
        data-role="assistant"
        data-faded={Boolean(assistant?.faded)}
        className={cn(
          'caption-line flex items-center gap-2 text-sm font-medium text-ink',
          assistant?.faded && 'caption-line--faded',
        )}
      >
        <span
          className="caption-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-2"
          style={{ boxShadow: '0 0 8px var(--color-brand-2)' }}
        />
        {assistant?.text}
      </p>
      <p
        data-role="user"
        data-faded={Boolean(user?.faded)}
        className={cn(
          'caption-line text-right text-sm text-ink-3',
          user?.faded && 'caption-line--faded',
        )}
      >
        {user?.text}
      </p>
    </div>
  );
}
