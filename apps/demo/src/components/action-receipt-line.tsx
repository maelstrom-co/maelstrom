import type { RequestOutcome } from '@maelstrom-co/client';
import { Fragment, useRef } from 'react';

import {
  nextReceiptOrder,
  useDirectReceipt,
} from '../lib/direct-action-receipt';
import { m } from '../lib/maelstrom';
import {
  isSettledOutcome,
  joinReceiptParts,
  type ReceiptPart,
  requestReceiptParts,
} from '../lib/request-receipt';

/**
 * One factual line about the last data change: the latest settled request,
 * typed or spoken, or a newer direct click. The band keeps its height when
 * empty so a receipt never resizes the Chart.
 */
export function ActionReceiptLine() {
  const parts = useLatestReceiptParts();
  const text = joinReceiptParts(parts);

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

interface SettledReceipt {
  readonly outcome: RequestOutcome;
  readonly parts: readonly ReceiptPart[];
  readonly order: number;
}

// A request still in flight keeps the previous receipt, so the line changes
// once per request rather than Action by Action. Outcomes are keyed in
// admission order and run one at a time, so the last settled one is the most
// recently settled request even while a later request waits in the queue.
function useLatestReceiptParts(): readonly ReceiptPart[] {
  const outcome = latestSettledOutcome(m.useRequestOutcomes());
  const direct = useDirectReceipt();
  const settled = useRef<SettledReceipt | null>(null);
  if (
    outcome &&
    isSettledOutcome(outcome) &&
    settled.current?.outcome !== outcome
  ) {
    settled.current = {
      outcome,
      parts: requestReceiptParts(outcome),
      order: nextReceiptOrder(),
    };
  }
  const request = settled.current;
  if (direct && (!request || direct.order > request.order))
    return [direct.part];
  return request?.parts ?? [];
}

function latestSettledOutcome(
  outcomes: Readonly<Record<string, RequestOutcome>>,
): RequestOutcome | undefined {
  const ordered = Object.values(outcomes);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const candidate = ordered[index];
    if (
      candidate &&
      isSettledOutcome(candidate) &&
      candidate.status !== 'not_submitted'
    )
      return candidate;
  }
  return undefined;
}
