import { cn } from '../lib/cn';
import { m } from '../lib/maelstrom';

/** How long a caption stays fully visible after its last fragment before it fades. */
const FADE_DELAY_MS = 3500;

/**
 * Live voice captions in the footer chrome, above the orb and intent input.
 * Every provider feeds the session's observation store, so captions read only
 * its latest caption per role. Streaming fragments render as they arrive; a
 * line with no new fragment for a few seconds fades rather than disappearing
 * abruptly, whether or not the provider finalized it.
 *
 * Always mounts a fixed-height band so showing or hiding captions cannot
 * resize the chart (and fire engine `chart_resize`). Lines clamp at two rows,
 * stack on narrow screens, and use the full row when only one speaker is shown.
 */
export function Captions() {
  const { assistant, user } = m.useVoiceCaptions({
    fadeDelayMs: FADE_DELAY_MS,
  });
  // Empty/whitespace entries still produce a caption object, so do not render
  // a lone accent dot or blank paragraph for those.
  const showAssistant =
    assistant !== undefined && assistant.text.trim().length > 0;
  const showUser = user !== undefined && user.text.trim().length > 0;

  return (
    <div
      data-testid="captions"
      className="demo-captions mx-auto mb-2 grid h-12 w-full max-w-4xl grid-cols-2 content-center gap-x-4 gap-y-1 overflow-hidden"
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
