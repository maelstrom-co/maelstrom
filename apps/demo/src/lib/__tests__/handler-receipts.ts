import {
  __resetDirectActionReceiptForTests,
  getDirectReceipt,
  nextReceiptOrder,
} from '../direct-action-receipt';
import { actionReceiptPart } from '../request-receipt';

interface HandlerResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: Error;
}

let invoked: { text: string; order: number } | null = null;

/**
 * Treats a handler result as the only Action of a settled request, the way
 * the receipt line reads an Engine-run Action from its request outcome.
 */
export function recordRequestResult(result: HandlerResult | undefined): void {
  if (!result) return;
  const part = actionReceiptPart(
    result.ok
      ? {
          status: 'ran',
          ...(typeof result.value === 'string' ? { note: result.value } : {}),
        }
      : { status: 'failed', reason: result.error?.message ?? '' },
  );
  invoked = { text: part?.text ?? '', order: nextReceiptOrder() };
}

/** The receipt line text: the newer of the last request result and direct click. */
export function latestReceiptText(): string {
  const direct = getDirectReceipt();
  if (direct && (!invoked || direct.order > invoked.order))
    return direct.part.text;
  return invoked?.text ?? '';
}

export function resetHandlerReceipts(): void {
  invoked = null;
  __resetDirectActionReceiptForTests();
}
