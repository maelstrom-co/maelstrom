import type { RequestOutcome, RequestOutcomeView } from '@maelstrom-co/client';
import type { ActionResult } from '@maelstrom-co/react';
import { useSyncExternalStore } from 'react';

import {
  isSettledOutcome,
  type ReceiptPart,
  resultReceiptPart,
} from './request-receipt';

export interface ActionSource {
  readonly vesselId: string;
  readonly action: string;
}

/** The receipt of the latest click, ordered against request receipts. */
export interface ClickReceipt {
  /** Null when the click changed nothing worth a receipt. */
  readonly part: ReceiptPart | null;
  readonly order: number;
}

/** Reads the receipt part of a clicked Action's handler result. */
export type ClickReceiptReader = (
  action: string,
  result: ActionResult,
) => ReceiptPart | null;

type LooseExecuteAction = (name: string, ...rest: unknown[]) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed executeAction overloads only share this shape
type AnyExecuteAction = (...args: any[]) => void;

const CLICK_MARK_TTL_MS = 5_000;

let marks: { source: ActionSource; expiresAt: number }[] = [];
let latest: ClickReceipt | null = null;
let nextOrder = 1;
const settledOrders = new WeakMap<RequestOutcome, number>();
const listeners = new Set<() => void>();

/**
 * Call right before a click's executeAction. A click never belongs to a
 * request outcome, so the handler run it starts reaches the receipt line
 * through this mark instead.
 */
export function markClick(source: ActionSource): void {
  marks.push({ source, expiresAt: Date.now() + CLICK_MARK_TTL_MS });
}

/** Wraps a Vessel's `executeAction` so every Action it runs is marked as a click. */
export function withClickMarks<Execute extends AnyExecuteAction>(
  vesselId: string,
  executeAction: Execute,
): Execute {
  const execute = executeAction as unknown as LooseExecuteAction;
  const marked: LooseExecuteAction = (action, ...rest) => {
    markClick({ vesselId, action });
    execute(action, ...rest);
  };
  return marked as unknown as Execute;
}

/**
 * Wraps Action handlers so a handler run started by a marked click publishes
 * its result as the click receipt. Engine-planned runs publish nothing here.
 */
export function withClickReceipts<Handlers extends object>(
  vesselId: string,
  handlers: Handlers,
  readReceipt: ClickReceiptReader = (_action, result) =>
    resultReceiptPart(result),
): Handlers {
  return Object.fromEntries(
    Object.entries(handlers).map(([action, handler]) => [
      action,
      async (...args: unknown[]) => {
        const clicked = consumeMark({ vesselId, action });
        const result = (await (
          handler as (
            ...args: unknown[]
          ) => ActionResult | Promise<ActionResult>
        )(...args)) as ActionResult;
        if (clicked) publish(readReceipt(action, result));
        return result;
      },
    ]),
  ) as Handlers;
}

/** The click receipt when it changed after the request receipt, otherwise null. */
export function newerClickReceipt(
  click: ClickReceipt | null,
  requestOrder: number | undefined,
): ClickReceipt | null {
  return click && click.order > (requestOrder ?? 0) ? click : null;
}

/** Increases with every receipt change, so a line can show whichever is newest. */
export function nextReceiptOrder(): number {
  return nextOrder++;
}

/**
 * Gives every request its receipt order when it settles, on the same counter
 * as clicks, so the order never depends on when the line renders. Returns the
 * cleanup that stops watching the store.
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

export function getClickReceipt(): ClickReceipt | null {
  return latest;
}

export function useClickReceipt(): ClickReceipt | null {
  return useSyncExternalStore(subscribe, getClickReceipt, getClickReceipt);
}

export function __resetClickReceiptsForTests(): void {
  marks = [];
  latest = null;
  for (const listener of listeners) listener();
}

function consumeMark(source: ActionSource): boolean {
  const now = Date.now();
  marks = marks.filter((mark) => mark.expiresAt > now);
  const index = marks.findIndex(
    (mark) =>
      mark.source.vesselId === source.vesselId &&
      mark.source.action === source.action,
  );
  if (index === -1) return false;
  marks.splice(index, 1);
  return true;
}

function publish(part: ReceiptPart | null): void {
  latest = { part, order: nextReceiptOrder() };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
