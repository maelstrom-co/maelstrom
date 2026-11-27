import type { ActionResult } from '@maelstrom-co/react';

import {
  __resetClickReceiptsForTests,
  getClickReceipt,
  newerClickReceipt,
  nextReceiptOrder,
} from '../click-receipt';
import { resultReceiptPart } from '../request-receipt';

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
  const part = resultReceiptPart(
    (result.ok
      ? { ok: true, value: result.value }
      : {
          ok: false,
          error: result.error ?? new Error(''),
        }) as ActionResult,
  );
  invoked = { text: part?.text ?? '', order: nextReceiptOrder() };
}

/** The receipt line text: the newer of the last request result and click. */
export function latestReceiptText(): string {
  const click = newerClickReceipt(getClickReceipt(), invoked?.order);
  if (click) return click.part?.text ?? '';
  return invoked?.text ?? '';
}

export function resetHandlerReceipts(): void {
  invoked = null;
  __resetClickReceiptsForTests();
}
