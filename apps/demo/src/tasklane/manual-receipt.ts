import type { ActionResult } from '@maelstrom-co/react';
import { useSyncExternalStore } from 'react';

import {
  failureText,
  type ReceiptLine,
  TASKLANE_DATA_ACTIONS,
} from './tasklane-activity';

export interface ManualReceipt {
  readonly sequence: number;
  /** Null when the click changed nothing worth a receipt. */
  readonly line: ReceiptLine | null;
}

type LooseExecuteAction = (name: string, ...rest: unknown[]) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed executeAction overloads only share this shape
type AnyExecuteAction = (...args: any[]) => void;

const MARK_TTL_MS = 5_000;

let marks: { action: string; expiresAt: number }[] = [];
let latest: ManualReceipt | null = null;
let nextSequence = 1;
const listeners = new Set<() => void>();

/**
 * Wraps a Vessel's `executeAction` so the handler that runs next for the same
 * Action knows a person clicked it. Request outcomes leave such clicks out by
 * design, so the receipt line hears about them here.
 */
export function withManualReceipt<Execute extends AnyExecuteAction>(
  executeAction: Execute,
): Execute {
  const execute = executeAction as unknown as LooseExecuteAction;
  const marked: LooseExecuteAction = (name, ...rest) => {
    marks.push({ action: name, expiresAt: Date.now() + MARK_TTL_MS });
    execute(name, ...rest);
  };
  return marked as unknown as Execute;
}

/**
 * Wraps Action handlers so a handler run started by a marked click publishes
 * its result as the manual receipt. Engine-planned runs publish nothing here.
 */
export function withManualReceipts<Handlers extends object>(
  handlers: Handlers,
): Handlers {
  return Object.fromEntries(
    Object.entries(handlers).map(([action, handler]) => [
      action,
      async (...args: unknown[]) => {
        const clicked = consumeMark(action);
        const result = (await (
          handler as (
            ...args: unknown[]
          ) => ActionResult | Promise<ActionResult>
        )(...args)) as ActionResult;
        if (clicked) publish(action, result);
        return result;
      },
    ]),
  ) as Handlers;
}

/** Increases with every receipt change, so the band can show whichever is newest. */
export function nextReceiptSequence(): number {
  return nextSequence++;
}

export function getManualReceipt(): ManualReceipt | null {
  return latest;
}

export function useManualReceipt(): ManualReceipt | null {
  return useSyncExternalStore(subscribe, getManualReceipt, getManualReceipt);
}

export function __resetManualReceiptForTests(): void {
  marks = [];
  latest = null;
  nextSequence = 1;
  for (const listener of listeners) listener();
}

function consumeMark(action: string): boolean {
  const now = Date.now();
  marks = marks.filter((mark) => mark.expiresAt > now);
  const index = marks.findIndex((mark) => mark.action === action);
  if (index === -1) return false;
  marks.splice(index, 1);
  return true;
}

function publish(action: string, result: ActionResult): void {
  let line: ReceiptLine | null = null;
  if (result.ok) {
    if (typeof result.value === 'string' && result.value)
      line = { text: `✓ ${result.value}`, tone: 'success' };
  } else {
    const text = failureText(
      result.error.message,
      TASKLANE_DATA_ACTIONS[action],
    );
    if (text) line = { text: `✗ ${text}`, tone: 'problem' };
  }
  latest = { sequence: nextReceiptSequence(), line };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
