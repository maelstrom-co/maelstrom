import type { VoiceCaption } from '@maelstrom-co/client';
import { useEffect, useState } from 'react';
import { mailM } from './maelstrom';

const FADE_DELAY_MS = 3000;

/**
 * Latest user caption line shown beside the voice orb. The band is always
 * mounted at a fixed size so showing or hiding a line never resizes the Chart.
 */
export function MailCaption() {
  const { state } = mailM.useVoice();
  const { snapshot } = mailM.useVoiceObservations();
  const user = useFadingCaption(
    snapshot.captions.filter((caption) => caption.role === 'user').at(-1),
    snapshot.generation,
  );

  const voiceLive = state !== 'idle' && state !== 'error';
  const showUser =
    voiceLive && user !== undefined && user.text.trim().length > 0;

  return (
    <div className="mail-caption" data-testid="mail-caption">
      {showUser ? (
        <p
          role="note"
          className="mail-caption-line"
          data-faded={user.faded}
          aria-label="Approximate user transcript"
        >
          {user.text}
        </p>
      ) : null}
    </div>
  );
}

function useFadingCaption(
  caption: VoiceCaption | undefined,
  generation: number,
): { readonly text: string; readonly faded: boolean } | undefined {
  const [faded, setFaded] = useState(false);
  const identity = caption?.id;
  const text = caption?.text;
  const final = caption?.final;

  useEffect(() => {
    setFaded(false);
    if (!final) return;
    const timeoutId = setTimeout(() => setFaded(true), FADE_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [identity, text, final, generation]);

  if (!caption) return undefined;
  return { text: caption.text, faded };
}
