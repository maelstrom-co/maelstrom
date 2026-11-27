import { useMemo } from 'react';

import { newerClickReceipt, useClickReceipt } from '../lib/click-receipt';
import { tasklaneM } from './maelstrom';
import { summariseReceipt } from './tasklane-activity';

// The band always renders at a fixed height, empty when there is nothing to
// report, so a receipt never resizes the dock or the Chart.
export function TasklaneReceiptLine() {
  tasklaneM.useRequestReferences();
  const outcome = tasklaneM.useRequestOutcome(tasklaneM.useReceiptRequestId());
  const requestReceipt = useMemo(() => summariseReceipt(outcome), [outcome]);
  const click = useClickReceipt();
  const requestOrder = tasklaneM.useRequestReceiptSequence();

  // Whichever changed last, the latest request or a click, owns the band.
  const newerClick = newerClickReceipt(click, requestOrder);
  const receipt = newerClick ? newerClick.part : requestReceipt;
  const text = receipt?.text ?? '';

  return (
    <div className="tasklane-receipt-band">
      <p
        className="tasklane-receipt"
        data-testid="tasklane-receipt"
        data-tone={receipt?.tone}
        aria-live="polite"
        title={text}
      >
        {text}
      </p>
    </div>
  );
}
