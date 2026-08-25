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
 * resize the chart (and fire engine `chart_resize`). Lines clamp at two rows,
 * stack on narrow screens, and use the full row when only one speaker is shown.
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
      className="mx-auto mb-2 grid h-12 w-full max-w-4xl grid-cols-2 content-center gap-x-4 gap-y-1 overflow-hidden"
    >
      {showAssistant && assistant ? (
        <p
          data-role="assistant"
          data-faded={Boolean(assistant.faded)}
          className={cn(
            'caption-line flex min-w-0 items-start gap-2 text-sm font-medium text-ink',
            !showUser && 'col-span-2',
            assistant.faded && 'caption-line--faded',
          )}
        >
          <span
            className="caption-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-2"
            style={{ boxShadow: '0 0 8px var(--color-brand-2)' }}
          />
          <span className="line-clamp-2">{assistant.text}</span>
        </p>
      ) : null}
      {showUser && user ? (
        <div
          role="note"
          data-role="user"
          data-faded={Boolean(user.faded)}
          aria-label="Approximate user transcript"
          className={cn(
            'caption-line min-w-0 text-right text-sm text-ink-3 line-clamp-2',
            !showAssistant && 'col-span-2',
            user.faded && 'caption-line--faded',
          )}
        >
          {user.text}
        </div>
      ) : null}
    </div>
  );
}
