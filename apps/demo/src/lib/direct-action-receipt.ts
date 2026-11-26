import { err, ok } from '@maelstrom-co/protocol';
import { useSyncExternalStore } from 'react';

import type { ReceiptPart } from './request-receipt';

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
const listeners = new Set<() => void>();

/**
 * Call right before a click's executeAction. A click never belongs to a
 * request outcome, so its handler result reaches the receipt line through
 * this mark instead.
 */
export function markDirectAction(source: ActionSource): void {
  directMarks.push({ source, expiresAt: Date.now() + DIRECT_MARK_TTL_MS });
}

/** A successful handler result whose note is the receipt text. */
export function noteResult(text: string, source: ActionSource) {
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
