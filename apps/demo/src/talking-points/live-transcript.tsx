import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import type { LiveTake } from './live-take';

export function LiveTranscript({ take }: { readonly take: LiveTake }) {
  const { phase, transcript } = useSyncExternalStore(
    take.subscribe,
    take.getSnapshot,
    take.getSnapshot,
  );
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [transcript]);
  if (phase === 'preparing') return null;
  return (
    <section className="talking-points-transcript" aria-label="Live transcript">
      <h2>Live transcript</h2>
      <div
        className="talking-points-transcript-scroll"
        ref={scroll}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus this scrollable region.
        tabIndex={0}
      >
        {transcript.length ? (
          transcript.map((part) => (
            <p
              key={JSON.stringify([part.itemId, part.contentIndex])}
              data-status={part.status}
            >
              {part.text}
            </p>
          ))
        ) : (
          <p className="talking-points-hint">Listening for speech…</p>
        )}
      </div>
    </section>
  );
}
