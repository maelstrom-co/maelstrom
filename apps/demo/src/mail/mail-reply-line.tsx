import type { IntentSnapshot, IntentSubmission } from '@maelstrom-co/client';
import { useIntentSubmission } from '@maelstrom-co/react';
import { useEffect, useState } from 'react';

export const MAIL_REPLY_FAILURE = 'Something went wrong, try again';

const REPLY_FADE_DELAY_MS = 8000;

/**
 * The assistant's reply to the latest typed request, shown under the search
 * bar. The line keeps a fixed height whether or not it has text, so a reply
 * never resizes the Chart.
 */
export function MailReplyLine({
  submission,
}: {
  readonly submission: IntentSubmission | null;
}) {
  const snapshot = useIntentSubmission(submission);
  const text = snapshot ? replyText(snapshot) : '';
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    setFaded(false);
    if (!text) return;
    const timeoutId = setTimeout(() => setFaded(true), REPLY_FADE_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [text]);

  return (
    <p
      className="mail-reply-line"
      data-testid="mail-reply-line"
      data-faded={faded}
      aria-live="polite"
      title={text || undefined}
    >
      {text}
    </p>
  );
}

function replyText(snapshot: IntentSnapshot): string {
  switch (snapshot.status) {
    case 'queued':
    case 'processing':
      return '';
    case 'applied':
      return snapshot.response.userMessage.trim();
    case 'failed':
    case 'unknown':
    case 'not_submitted':
      return MAIL_REPLY_FAILURE;
  }
}
