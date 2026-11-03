import { Fragment } from 'react';
import { latestReceiptParts, useActionActivity } from '../lib/action-activity';

/**
 * One factual line about the last data change, written by Action handlers.
 * The band keeps its height when empty so a receipt never resizes the Chart.
 */
export function ActionReceiptLine() {
  const parts = latestReceiptParts(useActionActivity());
  const text = parts.map((part) => part.text).join(' · ');

  return (
    <div
      className="action-receipt-line h-6 text-xs"
      data-testid="action-receipt-line"
      aria-live="polite"
      title={text || undefined}
    >
      {parts.map((part, index) => (
        <Fragment key={`${index}-${part.text}`}>
          {index > 0 && ' · '}
          <span data-tone={part.tone}>{part.text}</span>
        </Fragment>
      ))}
    </div>
  );
}
