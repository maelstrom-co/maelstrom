import type { RequestOutcome, RequestOutcomeView } from '@maelstrom-co/client';
import { err, ok } from '@maelstrom-co/protocol';
import { useSyncExternalStore } from 'react';

import { isSettledOutcome, type ReceiptPart } from './request-receipt';

export interface ActionSource {
  readonly vesselId: string;
  readonly action: string;
}

/** The receipt of the latest direct click, ordered against request receipts. */
export interface DirectReceipt {
  readonly part: ReceiptPart;
  readonly order: number;
}

const DIRECT_MARK_TTL_MS = 5_000;

let latest: DirectReceipt | null = null;
let nextOrder = 1;
let directMarks: { source: ActionSource; expiresAt: number }[] = [];
const settledOrders = new WeakMap<RequestOutcome, number>();
const listeners = new Set<() => void>();

/**
 * Call right before a click's executeAction. A click never belongs to a
 * request outcome, so its handler result reaches the receipt line through
 * this mark instead.
 */
export function markDirectAction(source: ActionSource): void {
  directMarks.push({ source, expiresAt: Date.now() + DIRECT_MARK_TTL_MS });
}

/** A successful handler result whose value is the receipt text. */
export function receiptResult(text: string, source: ActionSource) {
  publishIfDirect(source, { tone: 'success', text: `✓ ${text}` });
  return ok(text);
}

/**
 * A failed handler result. The receipt text, starting with "Couldn't", is the
 * first line of the error; Planner guidance follows on the next line.
 */
export function failureResult(
  text: string,
  source: ActionSource,
  plannerMessage?: string,
) {
  publishIfDirect(source, { tone: 'problem', text: `✗ ${text}` });
  return err(
    new Error(
      plannerMessage === undefined ? text : `${text}\n${plannerMessage}`,
    ),
  );
}

/** Increases with every receipt, so the line can show whichever is newest. */
export function nextReceiptOrder(): number {
  return nextOrder++;
}

/**
 * Gives every request its receipt order when it settles, on the same counter
 * as direct clicks, so the order never depends on when the line renders.
 * Returns the cleanup that stops watching the store.
 */
export function orderSettledRequests(
  store: RequestOutcomeView['store'],
): () => void {
  const orderSettled = () => {
    for (const outcome of Object.values(store.state.outcomes))
      if (isSettledOutcome(outcome)) settledRequestOrder(outcome);
  };
  orderSettled();
  const subscription = store.subscribe(orderSettled);
  return () => subscription.unsubscribe();
}

/**
 * The receipt order of a settled request. A request no store watcher saw
 * settle takes the next order on first read and keeps it across remounts.
 */
export function settledRequestOrder(outcome: RequestOutcome): number {
  const known = settledOrders.get(outcome);
  if (known !== undefined) return known;
  const order = nextReceiptOrder();
  settledOrders.set(outcome, order);
  return order;
}

export function getDirectReceipt(): DirectReceipt | null {
  return latest;
}

export function useDirectReceipt(): DirectReceipt | null {
  return useSyncExternalStore(subscribe, getDirectReceipt, getDirectReceipt);
}

export function __resetDirectActionReceiptForTests(): void {
  directMarks = [];
  latest = null;
  for (const listener of listeners) listener();
}

function publishIfDirect(source: ActionSource, part: ReceiptPart): void {
  if (!consumeDirectMark(source)) return;
  latest = { part, order: nextReceiptOrder() };
  for (const listener of listeners) listener();
}

function consumeDirectMark(source: ActionSource): boolean {
  const now = Date.now();
  directMarks = directMarks.filter((mark) => mark.expiresAt > now);
  const index = directMarks.findIndex(
    (mark) =>
      mark.source.vesselId === source.vesselId &&
      mark.source.action === source.action,
  );
  if (index === -1) return false;
  directMarks.splice(index, 1);
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
