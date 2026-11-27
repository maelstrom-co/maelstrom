import type { RequestOutcome } from '@maelstrom-co/client';

import {
  joinReceiptParts,
  problemPart,
  readActionReceipt,
  type ReceiptPart,
  successPart,
} from './request-receipt';

/**
 * Actions whose handlers return their receipt as the value. A planned one that did not
 * run, or failed without a "Couldn't" reason, is reported as not confirmed.
 */
export const LOGGED_DATA_ACTIONS: ReadonlySet<string> = new Set([
  'addTask',
  'removeTask',
  'checkTask',
  'uncheckTask',
  'addSubtask',
  'checkSubtask',
  'uncheckSubtask',
  'createEntry',
  'writeContent',
  'editEntry',
  'addEvent',
  'moveEvent',
  'removeEvent',
]);

/**
 * Handler receipts and failures in plan order, then the logged data Actions
 * that were not confirmed. Pending Actions contribute nothing yet.
 */
export function requestReceiptParts(
  outcome: Pick<RequestOutcome, 'actions'>,
): ReceiptPart[] {
  const parts: ReceiptPart[] = [];
  const unconfirmed: string[] = [];
  for (const action of outcome.actions) {
    const receipt = readActionReceipt(action);
    if (receipt.kind === 'done') parts.push(successPart(receipt.text));
    else if (receipt.kind === 'failed' && receipt.text !== null)
      parts.push(problemPart(receipt.text));
    else if (
      receipt.kind !== 'quiet' &&
      LOGGED_DATA_ACTIONS.has(action.action) &&
      !unconfirmed.includes(action.action)
    )
      unconfirmed.push(action.action);
  }
  for (const action of unconfirmed)
    parts.push({ tone: 'problem', text: `? Not confirmed: ${action}` });
  return parts;
}

/** Failures and unconfirmed Actions of one request, or null when it had none. */
export function requestProblemSummary(
  outcome: Pick<RequestOutcome, 'actions'>,
): string | null {
  const problems = requestReceiptParts(outcome).filter(
    (part) => part.tone === 'problem',
  );
  return problems.length > 0 ? joinReceiptParts(problems) : null;
}

/** Whether a handler reported a failure of its own for one of the request's Actions. */
export function hasReportedFailure(
  outcome: Pick<RequestOutcome, 'actions'>,
): boolean {
  return outcome.actions.some((action) => {
    const receipt = readActionReceipt(action);
    return receipt.kind === 'failed' && receipt.text !== null;
  });
}
