import type {
  RequestActionOutcome,
  RequestOutcome,
} from '@maelstrom-co/client';

export interface ReceiptPart {
  readonly tone: 'success' | 'problem';
  readonly text: string;
}

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

const RECEIPT_SEPARATOR = ' · ';
const FAILURE_PREFIX = "Couldn't";

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
    const part = actionReceiptPart(action);
    if (part) parts.push(part);
    else if (isUnconfirmed(action) && !unconfirmed.includes(action.action))
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
  return outcome.actions.some(
    (action) =>
      action.status === 'failed' && actionReceiptPart(action) !== null,
  );
}

/** The receipt part for one Action's own result, or null when it has none. */
export function actionReceiptPart(
  action:
    | { readonly status: 'ran'; readonly value?: unknown }
    | { readonly status: 'failed'; readonly reason: string }
    | { readonly status: 'pending' | 'skipped' | 'unknown' },
): ReceiptPart | null {
  if (action.status === 'ran')
    return typeof action.value === 'string' && action.value
      ? { tone: 'success', text: `✓ ${action.value}` }
      : null;
  if (action.status === 'failed') {
    const [reason = ''] = action.reason.split('\n');
    return reason.startsWith(FAILURE_PREFIX)
      ? { tone: 'problem', text: `✗ ${reason}` }
      : null;
  }
  return null;
}

/** Whether a request has settled, so its receipt can replace the previous one. */
export function isSettledOutcome(outcome: RequestOutcome): boolean {
  return outcome.status !== 'queued' && outcome.status !== 'processing';
}

export function joinReceiptParts(parts: readonly ReceiptPart[]): string {
  return parts.map((part) => part.text).join(RECEIPT_SEPARATOR);
}

function isUnconfirmed(action: RequestActionOutcome): boolean {
  if (!LOGGED_DATA_ACTIONS.has(action.action)) return false;
  return (
    action.status === 'skipped' ||
    action.status === 'unknown' ||
    action.status === 'failed'
  );
}
