import type { RequestOutcome } from '@maelstrom-co/client';
import { err, ok } from '@maelstrom-co/protocol';
import type { ActionResult } from '@maelstrom-co/react';

export interface ReceiptPart {
  readonly tone: 'success' | 'problem';
  readonly text: string;
}

/** The part of one Action's outcome a receipt reads. */
export type ActionStatus =
  | { readonly status: 'ran'; readonly value?: unknown }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'pending' | 'skipped' | 'unknown' };

/**
 * What one Action's own result says on a receipt line. A handler's value is
 * opaque, so only a non-empty string is a receipt. A failure has receipt text
 * only when the first line of its reason starts with "Couldn't".
 */
export type ActionReceipt =
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string | null }
  | { readonly kind: 'unconfirmed' }
  | { readonly kind: 'quiet' };

/** Reads one Action of a request outcome. Pending Actions stay quiet until they settle. */
export function readActionReceipt(action: ActionStatus): ActionReceipt {
  switch (action.status) {
    case 'ran': {
      const text = receiptText(action.value);
      return text === null ? { kind: 'quiet' } : { kind: 'done', text };
    }
    case 'failed':
      return { kind: 'failed', text: failureReceipt(action.reason) };
    case 'skipped':
    case 'unknown':
      return { kind: 'unconfirmed' };
    case 'pending':
      return { kind: 'quiet' };
  }
}

/** The receipt part for one Action's own result, or null when it has none. */
export function actionReceiptPart(action: ActionStatus): ReceiptPart | null {
  const receipt = readActionReceipt(action);
  if (receipt.kind === 'done') return successPart(receipt.text);
  if (receipt.kind === 'failed' && receipt.text !== null)
    return problemPart(receipt.text);
  return null;
}

/** The receipt part for a handler result, read the way a request outcome records it. */
export function resultReceiptPart(result: ActionResult): ReceiptPart | null {
  return actionReceiptPart(
    result.ok
      ? { status: 'ran', value: result.value }
      : { status: 'failed', reason: result.error.message },
  );
}

/** A successful handler result whose value is the receipt text. */
export function receiptResult(text: string) {
  return ok(text);
}

/**
 * A failed handler result. The receipt text, starting with "Couldn't", is the
 * first line of the error. Planner guidance follows on the next line.
 */
export function failureResult(text: string, plannerMessage?: string) {
  return err(
    new Error(
      plannerMessage === undefined ? text : `${text}\n${plannerMessage}`,
    ),
  );
}

/** The receipt text of a handler value, or null when the value is not one. */
export function receiptText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** The receipt text of a failure reason, or null when it has none for the person. */
export function failureReceipt(reason: string): string | null {
  const firstLine = reason.split('\n', 1)[0] ?? '';
  return firstLine.startsWith(FAILURE_PREFIX) ? firstLine : null;
}

export function successPart(text: string): ReceiptPart {
  return { tone: 'success', text: `✓ ${text}` };
}

export function problemPart(text: string): ReceiptPart {
  return { tone: 'problem', text: `✗ ${text}` };
}

export function joinReceiptParts(parts: readonly ReceiptPart[]): string {
  return parts.map((part) => part.text).join(RECEIPT_SEPARATOR);
}

/** Whether a request has settled, so its receipt can replace the previous one. */
export function isSettledOutcome(outcome: RequestOutcome): boolean {
  return outcome.status !== 'queued' && outcome.status !== 'processing';
}

const RECEIPT_SEPARATOR = ' · ';
const FAILURE_PREFIX = "Couldn't";
