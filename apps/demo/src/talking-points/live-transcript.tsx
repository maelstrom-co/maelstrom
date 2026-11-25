import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import type { LiveTake } from './live-take';

export function LiveTranscript({ take }: { readonly take: LiveTake }) {
  const { phase, transcript } = useSyncExternalStore(
    take.subscribe,
    take.getSnapshot,
    take.getSnapshot,
  );
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    if (scroll.current && following.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [transcript]);
  if (phase === 'preparing') return null;
  return (
    <section className="talking-points-transcript" aria-label="Live transcript">
      <h2>Live transcript</h2>
      <div
        className="talking-points-transcript-scroll"
        ref={scroll}
        onScroll={(event) => {
          const node = event.currentTarget;
          following.current =
            node.scrollHeight - node.clientHeight - node.scrollTop <= 32;
        }}
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
          <p className="talking-points-hint">
            {phase === 'stopped'
              ? 'No speech was transcribed.'
              : phase === 'starting'
                ? 'Preparing transcription…'
                : phase === 'finalizing'
                  ? 'Finishing transcription…'
                  : 'Listening for speech…'}
          </p>
        )}
      </div>
    </section>
  );
}
