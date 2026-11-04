import { useSyncExternalStore } from 'react';
import { FEEDBACK_CHARACTER_LIMIT } from './stores/feedback.store';
import { isTaskStatus, TASK_STATUS_NAMES } from './stores/project-tasks.store';

export type ChangeKind =
  | 'created'
  | 'moved'
  | 'described'
  | 'renamed'
  | 'edited'
  | 'assigned'
  | 'reassigned'
  | 'unassigned'
  | 'urgency'
  | 'status'
  | 'prioritised'
  | 'reprioritised'
  | 'deprioritised'
  | 'removed'
  | 'feedback';

export interface ChangeDescription {
  readonly kind: ChangeKind;
  /** The task title, or "feedback". */
  readonly subject: string;
  /** The task id, or "feedback". Receipts count distinct subjects, not entries. */
  readonly subjectId: string;
  /** Kind-specific detail: parent title (null for top level), assignee name, urgency, status, priority position, or "truncated". */
  readonly detail?: string | null;
}

export type ActivityEntry =
  | {
      readonly outcome: 'changed';
      readonly action: string;
      readonly change: ChangeDescription;
    }
  | { readonly outcome: 'unchanged'; readonly action: string }
  | {
      readonly outcome: 'failed';
      readonly action: string;
      readonly text: string;
    };

export interface ReceiptLine {
  readonly text: string;
  readonly tone: 'success' | 'problem';
}

/** Data Actions with the phrase a receipt uses when a planned one is skipped. */
export const TASKLANE_DATA_ACTIONS: Readonly<Record<string, string>> = {
  createTask: 'create a task',
  updateTask: 'update a task',
  setParent: 'move a task',
  assignTask: 'assign a task',
  setUrgency: 'set urgency',
  setStatus: 'set a task status',
  addToMyPriorities: 'add to your priorities',
  removeFromMyPriorities: 'remove from your priorities',
  removeTask: 'delete a task',
  replaceFeedback: 'replace the feedback',
};

interface ActivityWindow {
  readonly id: number;
  readonly requestId: string | null;
  readonly entries: readonly ActivityEntry[];
  readonly skippedActions: readonly string[];
  readonly closed: boolean;
}

interface ActivityState {
  readonly windows: readonly ActivityWindow[];
  readonly openWindowId: number | null;
  readonly nextWindowId: number;
}

const KEPT_WINDOWS = 20;
const INITIAL_STATE: ActivityState = {
  windows: [],
  openWindowId: null,
  nextWindowId: 1,
};

let state: ActivityState = INITIAL_STATE;
let latestReceipt: ReceiptLine | null = null;

const listeners = new Set<() => void>();

export function recordChange(action: string, change: ChangeDescription): void {
  record({ outcome: 'changed', action, change });
}

/** An Action that ran but found nothing to change: it confirms the plan step without a receipt part. */
export function recordUnchanged(action: string): void {
  record({ outcome: 'unchanged', action });
}

/** `text` starts with "Couldn't" and names what went wrong for the user. */
export function recordFailure(action: string, text: string): void {
  record({ outcome: 'failed', action, text });
}

/** Opens the window that collects every entry recorded while this request settles. */
export function openRequestWindow(requestId: string): void {
  const closedPrevious = closeOpenWindow(state.windows, state.openWindowId);
  const window: ActivityWindow = {
    id: state.nextWindowId,
    requestId,
    entries: [],
    skippedActions: [],
    closed: false,
  };
  setState({
    windows: keepRecent([...closedPrevious, window]),
    openWindowId: window.id,
    nextWindowId: state.nextWindowId + 1,
  });
}

/**
 * Records the planned Actions the orchestrator skipped for this request, for
 * example because their Instance was missing. Manual edits never appear here,
 * because they run outside the request's Action batch.
 */
export function settleRequestActions(
  requestId: string,
  skippedActions: readonly string[],
): void {
  updateRequestWindow(requestId, (window) => ({
    ...window,
    skippedActions: [...window.skippedActions, ...skippedActions],
  }));
}

export function failRequestWindow(requestId: string, text: string): void {
  updateRequestWindow(requestId, (window) => ({
    ...window,
    entries: [
      ...window.entries,
      { outcome: 'failed', action: 'request', text },
    ],
  }));
}

export function closeRequestWindow(): void {
  if (state.openWindowId === null) return;
  setState({
    ...state,
    windows: closeOpenWindow(state.windows, state.openWindowId),
    openWindowId: null,
  });
}

export function getLatestReceipt(): ReceiptLine | null {
  return latestReceipt;
}

export function useLatestReceipt(): ReceiptLine | null {
  return useSyncExternalStore(subscribe, getLatestReceipt, getLatestReceipt);
}

export function __resetTasklaneActivityForTests(): void {
  setState(INITIAL_STATE);
}

/**
 * One line for a window: failures and skipped planned Actions first, then
 * successes, joined by " · ". A window with nothing to report has no line.
 */
export function summariseReceipt(window: {
  readonly entries: readonly ActivityEntry[];
  readonly skippedActions: readonly string[];
}): ReceiptLine | null {
  const failures = window.entries.flatMap((entry) =>
    entry.outcome === 'failed' ? [`✗ ${entry.text}`] : [],
  );
  const unconfirmed = skippedPhrases(window.skippedActions);
  const successes = summariseChanges(
    window.entries.flatMap((entry) =>
      entry.outcome === 'changed' ? [entry.change] : [],
    ),
  );

  const parts = [
    ...failures,
    ...(unconfirmed.length > 0
      ? [`? Not confirmed: ${unconfirmed.join(', ')}`]
      : []),
    ...successes.map((text) => `✓ ${text}`),
  ];
  if (parts.length === 0) return null;
  return {
    text: parts.join(' · '),
    tone: failures.length > 0 || unconfirmed.length > 0 ? 'problem' : 'success',
  };
}

function record(entry: ActivityEntry): void {
  if (state.openWindowId !== null) {
    setState({
      ...state,
      windows: state.windows.map((window) =>
        window.id === state.openWindowId
          ? { ...window, entries: [...window.entries, entry] }
          : window,
      ),
    });
    return;
  }
  const window: ActivityWindow = {
    id: state.nextWindowId,
    requestId: null,
    entries: [entry],
    skippedActions: [],
    closed: true,
  };
  setState({
    ...state,
    windows: keepRecent([...state.windows, window]),
    nextWindowId: state.nextWindowId + 1,
  });
}

function updateRequestWindow(
  requestId: string,
  update: (window: ActivityWindow) => ActivityWindow,
): void {
  if (!state.windows.some((window) => window.requestId === requestId)) return;
  setState({
    ...state,
    windows: state.windows.map((window) =>
      window.requestId === requestId ? update(window) : window,
    ),
  });
}

function closeOpenWindow(
  windows: readonly ActivityWindow[],
  openWindowId: number | null,
): ActivityWindow[] {
  return windows.map((window) =>
    window.id === openWindowId ? { ...window, closed: true } : window,
  );
}

function keepRecent(windows: ActivityWindow[]): ActivityWindow[] {
  return windows.slice(-KEPT_WINDOWS);
}

function skippedPhrases(skipped: readonly string[]): string[] {
  const phrases: string[] = [];
  for (const action of skipped) {
    const phrase = TASKLANE_DATA_ACTIONS[action];
    if (phrase && !phrases.includes(phrase)) phrases.push(phrase);
  }
  return phrases;
}

function summariseChanges(changes: readonly ChangeDescription[]): string[] {
  const groups = new Map<string, ChangeDescription[]>();
  for (const change of changes) {
    const key = `${change.kind}\u0000${change.detail ?? ''}`;
    const group = groups.get(key);
    if (group) group.push(change);
    else groups.set(key, [change]);
  }
  return [...groups.values()].map(describeGroup);
}

function describeGroup(group: readonly ChangeDescription[]): string {
  const [first] = group as [ChangeDescription, ...ChangeDescription[]];
  const count = new Set(group.map((change) => change.subjectId)).size;
  const one = count === 1;
  const subject = `"${first.subject}"`;
  const tasks = `${count} tasks`;
  const detail = first.detail;
  switch (first.kind) {
    case 'created':
      return one ? `Created ${subject}` : `Created ${tasks}`;
    case 'moved':
      if (detail === null || detail === undefined)
        return one
          ? `Moved ${subject} to the top level`
          : `Moved ${tasks} to the top level`;
      return one
        ? `Moved ${subject} under "${detail}"`
        : `Grouped ${tasks} under "${detail}"`;
    case 'described':
      return one
        ? `Updated the description of ${subject}`
        : `Updated ${count} descriptions`;
    case 'renamed':
      return one ? `Renamed ${subject}` : `Renamed ${tasks}`;
    case 'edited':
      return one ? `Updated ${subject}` : `Updated ${tasks}`;
    case 'assigned':
      return one
        ? `Assigned ${subject} to ${detail}`
        : `Assigned ${tasks} to ${detail}`;
    case 'reassigned':
      return one
        ? `Reassigned ${subject} to ${detail}`
        : `Reassigned ${tasks} to ${detail}`;
    case 'unassigned':
      return one ? `Unassigned ${subject}` : `Unassigned ${tasks}`;
    case 'urgency':
      return one
        ? `Set ${subject} to ${detail} urgency`
        : `Set ${tasks} to ${detail} urgency`;
    case 'status': {
      const status = statusPhrase(detail);
      return one
        ? `Marked ${subject} as ${status}`
        : `Marked ${tasks} as ${status}`;
    }
    case 'prioritised':
      return one
        ? `Added ${subject} to your priorities`
        : `Added ${tasks} to your priorities`;
    case 'reprioritised':
      return one
        ? `Moved ${subject} to priority #${detail}`
        : 'Reordered your priorities';
    case 'deprioritised':
      return one
        ? `Removed ${subject} from your priorities`
        : `Removed ${tasks} from your priorities`;
    case 'removed':
      return one ? `Deleted ${subject}` : `Deleted ${tasks}`;
    case 'feedback':
      return detail === 'truncated'
        ? `Replaced the feedback (truncated to ${FEEDBACK_CHARACTER_LIMIT} characters)`
        : 'Replaced the feedback';
  }
}

function statusPhrase(status: string | null | undefined): string {
  return isTaskStatus(status)
    ? TASK_STATUS_NAMES[status].toLowerCase()
    : String(status);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: ActivityState): void {
  state = next;
  const latest = state.windows.at(-1);
  const receipt = latest ? summariseReceipt(latest) : null;
  if (
    receipt?.text !== latestReceipt?.text ||
    receipt?.tone !== latestReceipt?.tone
  )
    latestReceipt = receipt;
  for (const listener of listeners) listener();
}
