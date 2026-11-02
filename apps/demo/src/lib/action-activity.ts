import type { IntentSubmission } from '@maelstrom-co/client';
import type { ActionExecution } from '@maelstrom-co/protocol';
import { useSyncExternalStore } from 'react';

export type ActivityOutcome = 'changed' | 'unchanged' | 'failed';

export interface ActivityEntry {
  readonly sequence: number;
  readonly windowId: number;
  readonly outcome: ActivityOutcome;
  readonly text: string;
  readonly vesselId: string;
  readonly action: string;
}

export interface ActivitySource {
  readonly vesselId: string;
  readonly action: string;
}

export interface ActivityWindow {
  readonly id: number;
  readonly owner: string | null;
  readonly open: boolean;
  readonly executionPlan: readonly ActionExecution[] | null;
}

export interface ActivityState {
  readonly entries: readonly ActivityEntry[];
  readonly windows: readonly ActivityWindow[];
  readonly openWindowId: number | null;
}

export interface ReceiptPart {
  readonly tone: 'success' | 'problem';
  readonly text: string;
}

/**
 * Actions whose handlers write to this log. A planned Action from this set
 * with no entry in its window is reported as not confirmed.
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
const MAX_RETAINED_WINDOWS = 20;

let state: ActivityState = emptyState();
let nextSequence = 1;
let nextWindowId = 1;

const listeners = new Set<() => void>();

export function useActionActivity(): ActivityState {
  return useSyncExternalStore(
    subscribe,
    getActivitySnapshot,
    getActivitySnapshot,
  );
}

export function getActivitySnapshot(): ActivityState {
  return state;
}

export function __resetActionActivityForTests(): void {
  nextSequence = 1;
  nextWindowId = 1;
  setState(emptyState());
}

export function recordChange(text: string, source: ActivitySource): void {
  record('changed', text, source);
}

export function recordUnchanged(text: string, source: ActivitySource): void {
  record('unchanged', text, source);
}

export function recordFailure(text: string, source: ActivitySource): void {
  record('failed', text, source);
}

/**
 * Opens the window that collects entries for one Engine request, or returns
 * the open one. A different owner closes the open window first, so two
 * back-to-back requests never share a receipt.
 */
export function beginRequestWindow(owner?: string): number {
  const open = findOpenWindow();
  if (
    open &&
    (owner === undefined || open.owner === null || open.owner === owner)
  ) {
    if (owner !== undefined && open.owner === null) {
      updateWindow(open.id, { owner });
    }
    return open.id;
  }
  const window: ActivityWindow = {
    id: nextWindowId++,
    owner: owner ?? null,
    open: true,
    executionPlan: null,
  };
  setState(
    retain({
      ...state,
      windows: [
        ...state.windows.map((w) => (w.open ? { ...w, open: false } : w)),
        window,
      ],
      openWindowId: window.id,
    }),
  );
  return window.id;
}

/**
 * Closes the open window. Without an id only an unowned window closes, so a
 * late scheduler notification never cuts short a newer request's window.
 */
export function endRequestWindow(windowId?: number): void {
  const open = findOpenWindow();
  if (!open) return;
  if (windowId === undefined ? open.owner !== null : open.id !== windowId) {
    return;
  }
  setState({
    ...state,
    windows: state.windows.map((w) =>
      w.id === open.id ? { ...w, open: false } : w,
    ),
    openWindowId: null,
  });
}

/**
 * Follows one submitted intent: its window opens when it starts processing
 * and closes with its Execution Plan once it settles. Returns the window id
 * getter, null until processing starts.
 */
export function trackSubmissionWindow(
  submission: IntentSubmission,
): () => number | null {
  let windowId: number | null = null;
  const sync = () => {
    if (windowId === null && submission.store.state.status === 'processing') {
      windowId = beginRequestWindow(submission.id);
    }
  };
  const subscription = submission.store.subscribe(sync);
  sync();
  void submission.result.then((result) => {
    subscription.unsubscribe();
    if (windowId === null) return;
    endRequestWindow(windowId);
    if (result.status === 'applied') {
      attachExecutionPlan(windowId, result.response.executionPlan);
    }
  });
  return () => windowId;
}

export function attachExecutionPlan(
  windowId: number,
  executionPlan: readonly ActionExecution[],
): void {
  updateWindow(windowId, { executionPlan });
}

export function summariseReceipt(
  entries: readonly ActivityEntry[],
  executionPlan: readonly ActionExecution[] | null,
): string | null {
  const parts = receiptParts(entries, executionPlan);
  return parts.length > 0 ? joinParts(parts) : null;
}

export function receiptParts(
  entries: readonly ActivityEntry[],
  executionPlan: readonly ActionExecution[] | null,
): ReceiptPart[] {
  const parts: ReceiptPart[] = entries.map((entry) =>
    entry.outcome === 'failed'
      ? { tone: 'problem', text: `✗ ${entry.text}` }
      : { tone: 'success', text: `✓ ${entry.text}` },
  );
  for (const action of unconfirmedActions(entries, executionPlan)) {
    parts.push({ tone: 'problem', text: `? Not confirmed: ${action}` });
  }
  return parts;
}

/** Parts of the most recent finished window, empty when it changed no data. */
export function latestReceiptParts(activity: ActivityState): ReceiptPart[] {
  // An Engine turn nobody asked for, such as a chart_resize, keeps the last
  // receipt. A request the user made clears it when it changed nothing.
  const latest = [...activity.windows]
    .reverse()
    .find(
      (w) =>
        !w.open &&
        (w.owner !== null ||
          activity.entries.some((entry) => entry.windowId === w.id)),
    );
  return latest ? partsForWindow(activity, latest) : [];
}

/** Failures and unconfirmed Actions of one request, or null when it had none. */
export function problemSummaryForWindow(
  activity: ActivityState,
  windowId: number,
): string | null {
  const window = activity.windows.find((w) => w.id === windowId);
  if (!window) return null;
  const problems = partsForWindow(activity, window).filter(
    (part) => part.tone === 'problem',
  );
  return problems.length > 0 ? joinParts(problems) : null;
}

export function describeAddedTask(title: string, subtaskCount: number): string {
  if (subtaskCount === 0) return `Added "${title}"`;
  return `Added "${title}" with ${subtaskCount} ${subtaskCount === 1 ? 'subtask' : 'subtasks'}`;
}

function emptyState(): ActivityState {
  return { entries: [], windows: [], openWindowId: null };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: ActivityState): void {
  state = next;
  for (const listener of listeners) listener();
}

function findOpenWindow(): ActivityWindow | undefined {
  if (state.openWindowId === null) return undefined;
  return state.windows.find((w) => w.id === state.openWindowId);
}

function updateWindow(windowId: number, patch: Partial<ActivityWindow>): void {
  if (!state.windows.some((w) => w.id === windowId)) return;
  setState({
    ...state,
    windows: state.windows.map((w) =>
      w.id === windowId ? { ...w, ...patch } : w,
    ),
  });
}

function record(
  outcome: ActivityOutcome,
  text: string,
  source: ActivitySource,
): void {
  const open = findOpenWindow();
  const window: ActivityWindow = open ?? {
    id: nextWindowId++,
    owner: null,
    open: false,
    executionPlan: null,
  };
  const entry: ActivityEntry = {
    sequence: nextSequence++,
    windowId: window.id,
    outcome,
    text,
    vesselId: source.vesselId,
    action: source.action,
  };
  setState(
    retain({
      ...state,
      windows: open ? state.windows : [...state.windows, window],
      entries: [...state.entries, entry],
    }),
  );
}

function retain(next: ActivityState): ActivityState {
  if (next.windows.length <= MAX_RETAINED_WINDOWS) return next;
  const windows = next.windows.slice(-MAX_RETAINED_WINDOWS);
  const oldest = windows[0].id;
  return {
    ...next,
    windows,
    entries: next.entries.filter((entry) => entry.windowId >= oldest),
  };
}

function partsForWindow(
  activity: ActivityState,
  window: ActivityWindow,
): ReceiptPart[] {
  return receiptParts(
    activity.entries.filter((entry) => entry.windowId === window.id),
    window.executionPlan,
  );
}

function unconfirmedActions(
  entries: readonly ActivityEntry[],
  executionPlan: readonly ActionExecution[] | null,
): string[] {
  if (!executionPlan) return [];
  const remaining = new Map<string, number>();
  for (const entry of entries) {
    remaining.set(entry.action, (remaining.get(entry.action) ?? 0) + 1);
  }
  const missing: string[] = [];
  for (const { action } of executionPlan) {
    if (!LOGGED_DATA_ACTIONS.has(action)) continue;
    const count = remaining.get(action) ?? 0;
    if (count > 0) {
      remaining.set(action, count - 1);
    } else if (!missing.includes(action)) {
      missing.push(action);
    }
  }
  return missing;
}

function joinParts(parts: readonly ReceiptPart[]): string {
  return parts.map((part) => part.text).join(RECEIPT_SEPARATOR);
}
