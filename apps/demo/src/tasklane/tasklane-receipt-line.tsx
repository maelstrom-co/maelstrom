import { useEffect, useMemo, useState } from 'react';

import { tasklaneM } from './maelstrom';
import { useManualReceipt } from './manual-receipt';
import { summariseReceipt } from './tasklane-activity';

// The band always renders at a fixed height, empty when there is nothing to
// report, so a receipt never resizes the dock or the Chart.
export function TasklaneReceiptLine() {
  tasklaneM.useRequestReferences();
  const outcome = tasklaneM.useLatestRequestOutcome();
  const requestReceipt = useMemo(() => summariseReceipt(outcome), [outcome]);
  const manual = useManualReceipt();
  const [showManual, setShowManual] = useState(false);
  const requestKey = `${outcome?.id ?? ''}\u0000${requestReceipt?.text ?? ''}\u0000${requestReceipt?.tone ?? ''}`;

  // Whichever changed last, the latest request or a click, owns the band.
  useEffect(() => setShowManual(false), [requestKey]);
  useEffect(() => {
    if (manual) setShowManual(true);
  }, [manual]);

  const receipt = showManual && manual ? manual.line : requestReceipt;
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
