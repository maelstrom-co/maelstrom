import { tasklaneM } from './maelstrom';
import { useLatestReceipt } from './tasklane-activity';

// The band always renders at a fixed height, empty when there is nothing to
// report, so a receipt never resizes the dock or the Chart.
export function TasklaneReceiptLine() {
  tasklaneM.useRequestActivity();
  const receipt = useLatestReceipt();
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
