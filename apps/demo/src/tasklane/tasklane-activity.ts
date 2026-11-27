import type { RequestActionOutcome, RequestOutcome } from '@maelstrom-co/react';

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
  | 'dueDate'
  | 'prioritised'
  | 'reprioritised'
  | 'deprioritised'
  | 'removed'
  | 'feedback';

export interface ChangeDescription {
  readonly kind: ChangeKind;
  /** The task title, or "feedback". */
  readonly subject: string;
  /** Kind-specific detail: parent title (null for top level), assignee name, urgency, status, priority position, or "truncated". */
  readonly detail?: string | null;
}

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
  setDueDate: 'set a due date',
  addToMyPriorities: 'add to your priorities',
  removeFromMyPriorities: 'remove from your priorities',
  removeTask: 'delete a task',
  replaceFeedback: 'replace the feedback',
};

const SEPARATOR = ' · ';
const TASK_ID = /^(TL-\d+)\b/i;

interface ChangeForm {
  readonly kind: ChangeKind;
  readonly pattern: RegExp;
  readonly hasDetail: boolean;
  readonly one: (subject: string, detail: string | null) => string;
  readonly many: (count: number, detail: string | null) => string;
}

// Each form writes the receipt a handler returns for one change and reads it
// back, so a receipt can group same-kind changes of one request.
const CHANGE_FORMS: readonly ChangeForm[] = [
  {
    kind: 'created',
    pattern: /^Created "(.+)"$/,
    hasDetail: false,
    one: (s) => `Created ${s}`,
    many: (n) => `Created ${n} tasks`,
  },
  {
    kind: 'reprioritised',
    pattern: /^Moved "(.+)" to priority #(\d+)$/,
    hasDetail: true,
    one: (s, d) => `Moved ${s} to priority #${d}`,
    many: () => 'Reordered your priorities',
  },
  {
    kind: 'moved',
    pattern: /^Moved "(.+)" to the top level$/,
    hasDetail: false,
    one: (s) => `Moved ${s} to the top level`,
    many: (n) => `Moved ${n} tasks to the top level`,
  },
  {
    kind: 'moved',
    pattern: /^Moved "(.+)" under "(.+)"$/,
    hasDetail: true,
    one: (s, d) => `Moved ${s} under "${d}"`,
    many: (n, d) => `Grouped ${n} tasks under "${d}"`,
  },
  {
    kind: 'described',
    pattern: /^Updated the description of "(.+)"$/,
    hasDetail: false,
    one: (s) => `Updated the description of ${s}`,
    many: (n) => `Updated ${n} descriptions`,
  },
  {
    kind: 'renamed',
    pattern: /^Renamed "(.+)"$/,
    hasDetail: false,
    one: (s) => `Renamed ${s}`,
    many: (n) => `Renamed ${n} tasks`,
  },
  {
    kind: 'edited',
    pattern: /^Updated "(.+)"$/,
    hasDetail: false,
    one: (s) => `Updated ${s}`,
    many: (n) => `Updated ${n} tasks`,
  },
  {
    kind: 'assigned',
    pattern: /^Assigned "(.+)" to (.+)$/,
    hasDetail: true,
    one: (s, d) => `Assigned ${s} to ${d}`,
    many: (n, d) => `Assigned ${n} tasks to ${d}`,
  },
  {
    kind: 'reassigned',
    pattern: /^Reassigned "(.+)" to (.+)$/,
    hasDetail: true,
    one: (s, d) => `Reassigned ${s} to ${d}`,
    many: (n, d) => `Reassigned ${n} tasks to ${d}`,
  },
  {
    kind: 'unassigned',
    pattern: /^Unassigned "(.+)"$/,
    hasDetail: false,
    one: (s) => `Unassigned ${s}`,
    many: (n) => `Unassigned ${n} tasks`,
  },
  {
    kind: 'urgency',
    pattern: /^Set "(.+)" to (.+) urgency$/,
    hasDetail: true,
    one: (s, d) => `Set ${s} to ${d} urgency`,
    many: (n, d) => `Set ${n} tasks to ${d} urgency`,
  },
  {
    kind: 'status',
    pattern: /^Marked "(.+)" as (.+)$/,
    hasDetail: true,
    one: (s, d) => `Marked ${s} as ${d}`,
    many: (n, d) => `Marked ${n} tasks as ${d}`,
  },
  {
    kind: 'dueDate',
    pattern: /^Set "(.+)" due (\d{4}-\d{2}-\d{2})$/,
    hasDetail: true,
    one: (s, d) => `Set ${s} due ${d}`,
    many: (n, d) => `Set ${n} tasks due ${d}`,
  },
  {
    kind: 'dueDate',
    pattern: /^Cleared the due date on "(.+)"$/,
    hasDetail: false,
    one: (s) => `Cleared the due date on ${s}`,
    many: (n) => `Cleared due dates on ${n} tasks`,
  },
  {
    kind: 'prioritised',
    pattern: /^Added "(.+)" to your priorities$/,
    hasDetail: false,
    one: (s) => `Added ${s} to your priorities`,
    many: (n) => `Added ${n} tasks to your priorities`,
  },
  {
    kind: 'deprioritised',
    pattern: /^Removed "(.+)" from your priorities$/,
    hasDetail: false,
    one: (s) => `Removed ${s} from your priorities`,
    many: (n) => `Removed ${n} tasks from your priorities`,
  },
  {
    kind: 'removed',
    pattern: /^Deleted "(.+)"$/,
    hasDetail: false,
    one: (s) => `Deleted ${s}`,
    many: (n) => `Deleted ${n} tasks`,
  },
];

// Kinds with one form that names a detail and one that does not.
const DETAIL_OPTIONAL_KINDS: ReadonlySet<ChangeKind> = new Set([
  'moved',
  'dueDate',
]);

/** The receipt a handler returns as its value for one change, read back by {@link summariseReceipt}. */
export function describeChange(change: ChangeDescription): string {
  if (change.kind === 'feedback') {
    return change.detail === 'truncated'
      ? `Replaced the feedback (truncated to ${FEEDBACK_CHARACTER_LIMIT} characters)`
      : 'Replaced the feedback';
  }
  const detail =
    change.kind === 'status'
      ? statusPhrase(change.detail)
      : (change.detail ?? null);
  const form = CHANGE_FORMS.find(
    (candidate) =>
      candidate.kind === change.kind &&
      (!DETAIL_OPTIONAL_KINDS.has(change.kind) ||
        candidate.hasDetail === (detail !== null)),
  );
  if (!form) return change.subject;
  return form.one(`"${change.subject}"`, detail);
}

/**
 * One line for a request: failures first, then planned data Actions that were
 * skipped or whose outcome is unknown, then successes, joined by " · ".
 * Same-kind successes are grouped. A request with nothing to report has no line.
 */
export function summariseReceipt(
  outcome: RequestOutcome | null | undefined,
): ReceiptLine | null {
  if (!outcome) return null;
  const failures: string[] = [];
  const unconfirmed: string[] = [];
  const receipts: { action: RequestActionOutcome; text: string }[] = [];
  for (const action of outcome.actions) {
    const phrase = TASKLANE_DATA_ACTIONS[action.action];
    switch (action.status) {
      case 'ran':
        if (typeof action.value === 'string' && action.value)
          receipts.push({ action, text: action.value });
        break;
      case 'failed': {
        const text = failureText(action.reason, phrase);
        if (text) failures.push(`✗ ${text}`);
        break;
      }
      case 'skipped':
      case 'unknown':
        if (phrase && !unconfirmed.includes(phrase)) unconfirmed.push(phrase);
        break;
      case 'pending':
        break;
    }
  }
  // An unknown outcome may have taken effect, so it is never shown as failed.
  if (outcome.actions.length === 0) {
    if (outcome.status === 'failed')
      failures.push("✗ Couldn't complete the request");
    else if (outcome.status === 'unknown') unconfirmed.push('the request');
  }

  const parts = [
    ...failures,
    ...(unconfirmed.length > 0
      ? [`? Not confirmed: ${unconfirmed.join(', ')}`]
      : []),
    ...groupReceipts(receipts).map((text) => `✓ ${text}`),
  ];
  if (parts.length === 0) return null;
  return {
    text: parts.join(SEPARATOR),
    tone: failures.length > 0 || unconfirmed.length > 0 ? 'problem' : 'success',
  };
}

/** The receipt line for one Action's failure reason, or null when it has none for the person. */
export function failureText(
  reason: string,
  phrase: string | undefined,
): string | null {
  const firstLine = reason.split('\n', 1)[0] ?? '';
  if (firstLine.startsWith("Couldn't")) return firstLine;
  return phrase ? `Couldn't ${phrase}` : null;
}

function groupReceipts(
  receipts: readonly { action: RequestActionOutcome; text: string }[],
): string[] {
  const groups = new Map<
    string,
    {
      form: ChangeForm | null;
      detail: string | null;
      subjects: string[];
      first: string;
    }
  >();
  receipts.forEach(({ action, text }, index) => {
    const parsed = parseReceipt(text);
    const key = parsed
      ? `${CHANGE_FORMS.indexOf(parsed.form)}\u0000${parsed.detail ?? ''}`
      : `text\u0000${text}`;
    const subject = parsed ? subjectKey(action, parsed.subject, index) : text;
    const group = groups.get(key);
    if (group) {
      if (!group.subjects.includes(subject)) group.subjects.push(subject);
    } else {
      groups.set(key, {
        form: parsed?.form ?? null,
        detail: parsed?.detail ?? null,
        subjects: [subject],
        first: text,
      });
    }
  });
  return [...groups.values()].map((group) =>
    group.form && group.subjects.length > 1
      ? group.form.many(group.subjects.length, group.detail)
      : group.first,
  );
}

function parseReceipt(
  text: string,
): { form: ChangeForm; subject: string; detail: string | null } | null {
  for (const form of CHANGE_FORMS) {
    const match = form.pattern.exec(text);
    if (!match?.[1]) continue;
    return {
      form,
      subject: match[1],
      detail: form.hasDetail ? (match[2] ?? null) : null,
    };
  }
  return null;
}

// Each created task is new. Other changes count the task they target, by its
// id when the Planner referenced one, so a task changed twice counts once and
// two tasks sharing a title count twice.
function subjectKey(
  action: RequestActionOutcome,
  subject: string,
  index: number,
): string {
  if (action.action === 'createTask') return `created#${index}`;
  const reference = action.params?.['task'];
  const id =
    typeof reference === 'string' ? TASK_ID.exec(reference.trim())?.[1] : null;
  return id ? id.toUpperCase() : `title:${subject}`;
}

function statusPhrase(status: string | null | undefined): string {
  return isTaskStatus(status)
    ? TASK_STATUS_NAMES[status].toLowerCase()
    : String(status);
}
