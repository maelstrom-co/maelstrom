import { useSyncExternalStore } from 'react';
import { FEEDBACK_CHARACTER_LIMIT } from './feedback.store';
import {
  describeTeamChoices,
  resolveAssignee,
  type TeamMemberId,
  teamMember,
} from './team';

export type TaskUrgency = 'low' | 'normal' | 'high';

export const TASK_URGENCIES: readonly TaskUrgency[] = ['low', 'normal', 'high'];

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** How each status reads to a person: "To do", "In progress", "Done". */
export const TASK_STATUS_NAMES: Readonly<Record<TaskStatus, string>> = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
};

/**
 * Longest feedback quote a task keeps, in characters. It matches the feedback
 * limit, so any quote copied from the feedback is kept whole and still matches
 * its paragraph.
 */
export const SOURCE_FEEDBACK_LIMIT = FEEDBACK_CHARACTER_LIMIT;

export const NO_PARENT = 'none';

export interface ProjectTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly parentId: string | null;
  readonly assigneeId: TeamMemberId | null;
  readonly urgency: TaskUrgency;
  readonly status: TaskStatus;
  /** The feedback quote the task was created from, or null. */
  readonly sourceFeedback: string | null;
}

export interface ProjectTasksState {
  readonly project: string;
  readonly tasks: readonly ProjectTask[];
  /** Chris's own ordered list of task ids, separate from each task's urgency. */
  readonly myPriorities: readonly string[];
  /**
   * The feedback quotes of removed tasks as `normalizeFeedbackQuote` keys,
   * each kept once, so a quote can tell dropped from never covered.
   */
  readonly removedSourceFeedback: readonly string[];
  readonly nextNumber: number;
}

export type TaskFailure =
  | { readonly ok: false; readonly reason: 'empty_title' }
  | {
      readonly ok: false;
      readonly reason:
        | 'task_not_found'
        | 'parent_not_found'
        | 'unknown_assignee'
        | 'unknown_urgency'
        | 'unknown_status';
      readonly query: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'ambiguous_task' | 'ambiguous_parent';
      readonly query: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'cycle';
      readonly task: ProjectTask;
      readonly parent: ProjectTask;
    }
  | {
      readonly ok: false;
      readonly reason: 'bad_position';
      readonly position: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'not_in_priorities';
      readonly task: ProjectTask;
    }
  | {
      readonly ok: false;
      readonly reason: 'stale_reference';
      /** Whether the stale reference named the task being changed or its new parent. */
      readonly role: 'task' | 'parent';
      readonly query: string;
      readonly task: ProjectTask;
    };

/** The failures resolving a task reference alone can produce. */
export type TaskLookupFailure =
  | {
      readonly ok: false;
      readonly reason: 'task_not_found';
      readonly query: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'ambiguous_task';
      readonly query: string;
      readonly candidates: readonly string[];
    };

export type TaskChange =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly task: ProjectTask;
      readonly previous: ProjectTask;
    }
  | TaskFailure;

export type CreateTaskResult =
  | { readonly ok: true; readonly task: ProjectTask }
  | TaskFailure;

export type PriorityChange =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly task: ProjectTask;
      readonly position: number;
      readonly previousPosition: number | null;
    }
  | TaskFailure;

export type RemoveTaskResult =
  | {
      readonly ok: true;
      readonly task: ProjectTask;
      readonly reparentedChildren: number;
    }
  | TaskFailure;

export type TaskReferenceMatch =
  | { readonly kind: 'found'; readonly task: ProjectTask }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] }
  | { readonly kind: 'stale'; readonly task: ProjectTask };

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string;
  readonly parent?: string;
  readonly assignee?: string;
  readonly urgency?: string;
  /** The feedback quote the task comes from. */
  readonly source?: string;
}

export interface TaskRow {
  readonly task: ProjectTask;
  readonly depth: number;
}

const INITIAL_STATE: ProjectTasksState = {
  project: 'Maelstrom demo',
  tasks: [
    {
      id: 'TL-1',
      title: 'Update demo README',
      description: 'Refresh the setup steps for the demo app.',
      parentId: null,
      assigneeId: 'alex',
      urgency: 'normal',
      status: 'todo',
      sourceFeedback: null,
    },
    {
      id: 'TL-2',
      title: 'Record launch video',
      description: 'A two-minute walkthrough of the demo.',
      parentId: null,
      assigneeId: 'sam',
      urgency: 'normal',
      status: 'todo',
      sourceFeedback: null,
    },
  ],
  myPriorities: [],
  removedSourceFeedback: [],
  nextNumber: 3,
};

const TASK_ID = /^(TL-\d+)\b/i;
const PUBLISHED_LABEL = /^TL-\d+ .+ \([^()]+\)$/i;
const NO_PARENT_WORDS = new Set([NO_PARENT, '', 'no parent', 'top level']);
const MAX_LISTED_TASKS = 30;
const PUBLISHED_TITLE_LIMIT = 60;
// U+0085 is included because the client turns it into a space in the options
// the Planner sees, and a label must come back exactly as it was published.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what must be replaced.
const UNSAFE_LABEL_CHARACTERS = /[|\x00-\x1f\x7f\x85]+/g;
const SURROUNDING_QUOTE_MARKS = /^["'“”‘’]+|["'“”‘’]+$/g;

let state: ProjectTasksState = INITIAL_STATE;
let requestReferences: ReadonlySet<string> = new Set();

const listeners = new Set<() => void>();

export function useProjectTasksStore(): ProjectTasksState {
  return useSyncExternalStore(
    subscribe,
    getProjectTasksSnapshot,
    getProjectTasksSnapshot,
  );
}

export function getProjectTasksSnapshot(): ProjectTasksState {
  return state;
}

export function __resetProjectTasksStoreForTests(): void {
  requestReferences = new Set();
  setState(INITIAL_STATE);
}

/**
 * Remembers the current labels when a response arrives, before its Actions
 * run. A plan may name a task by that label even after an earlier step in the
 * same plan changed that task's status.
 */
export function rememberRequestReferences(): void {
  requestReferences = new Set(
    state.tasks.map((task) => taskReferenceLabel(task)),
  );
}

/**
 * Resolves a task reference: an id (`TL-3`), a published label that starts
 * with the id, an exact title, or a fuzzy title. An id that matches no task
 * is not retried as a title. A label whose status is neither current nor
 * remembered from the request start is stale, because the task changed after
 * the label was published.
 */
export function resolveTaskReference(
  reference: string,
  tasks: readonly ProjectTask[] = state.tasks,
): TaskReferenceMatch {
  const query = reference.trim();
  if (!query) return { kind: 'not_found' };

  const id = TASK_ID.exec(query)?.[1]?.toUpperCase();
  if (id) {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) return { kind: 'not_found' };
    if (
      PUBLISHED_LABEL.test(query) &&
      query !== taskReferenceLabel(task) &&
      !requestReferences.has(query)
    ) {
      return { kind: 'stale', task };
    }
    return { kind: 'found', task };
  }

  const wanted = normalizeTitle(query);
  const exact = tasks.filter((task) => normalizeTitle(task.title) === wanted);
  if (exact.length > 0) return matchFrom(exact);

  return matchFrom(findByFuzzyTitle(wanted, tasks));
}

/**
 * `TL-1 Update demo README (Alex, normal, not in priorities)`. The title is
 * cleaned of option delimiters and control characters and shortened, so the
 * label is safe as an enum value.
 */
export function taskReferenceLabel(
  task: ProjectTask,
  priorities: readonly string[] = state.myPriorities,
): string {
  return `${task.id} ${publishedTitle(task.title)} (${taskSummary(task, priorities)})`;
}

/**
 * `Alex, normal, not in priorities`. Leaves out the status, so a label stays
 * current when a task only moves between columns.
 */
export function taskSummary(
  task: ProjectTask,
  priorities: readonly string[] = state.myPriorities,
): string {
  return `${assigneeLabel(task.assigneeId)}, ${task.urgency}, ${priorityLabel(task.id, priorities)}`;
}

export function assigneeLabel(assigneeId: TeamMemberId | null): string {
  return assigneeId ? teamMember(assigneeId).name : 'unassigned';
}

export function priorityLabel(
  taskId: string,
  priorities: readonly string[] = state.myPriorities,
): string {
  const index = priorities.indexOf(taskId);
  return index === -1 ? 'not in priorities' : `priority #${index + 1}`;
}

/**
 * The one form feedback quotes are compared and stored in: cleaned of the
 * characters a stored quote has replaced, without surrounding quote marks,
 * with whitespace collapsed and lower case. The Planner may copy a quote with
 * or without its quote marks.
 */
export function normalizeFeedbackQuote(text: string): string {
  return text
    .replace(UNSAFE_LABEL_CHARACTERS, ' ')
    .trim()
    .replace(SURROUNDING_QUOTE_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Parents before their children, depth-first, in creation order. */
export function orderedTaskRows(
  tasks: readonly ProjectTask[] = state.tasks,
): TaskRow[] {
  const known = new Set(tasks.map((task) => task.id));
  const rows: TaskRow[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const task of tasks) {
      const effectiveParent =
        task.parentId && known.has(task.parentId) ? task.parentId : null;
      if (effectiveParent !== parentId) continue;
      rows.push({ task, depth });
      visit(task.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.some((status) => status === value);
}

/** Open means not done. */
export function isOpenTask(task: ProjectTask): boolean {
  return task.status !== 'done';
}

/** Urgent means high urgency. */
export function isUrgentTask(task: ProjectTask): boolean {
  return task.urgency === 'high';
}

/** The tasks in Chris's priorities, top first. */
export function prioritisedTasks(
  state: Pick<
    ProjectTasksState,
    'tasks' | 'myPriorities'
  > = getProjectTasksSnapshot(),
): ProjectTask[] {
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  return state.myPriorities.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
}

/** Ids of the task's children, grandchildren and so on. */
export function descendantIds(
  taskId: string,
  tasks: readonly ProjectTask[] = state.tasks,
): Set<string> {
  const found = new Set<string>();
  const pending = [taskId];
  for (let current = pending.pop(); current; current = pending.pop()) {
    for (const task of tasks) {
      if (task.parentId === current && !found.has(task.id)) {
        found.add(task.id);
        pending.push(task.id);
      }
    }
  }
  return found;
}

export const projectTaskActions = {
  createTask(input: CreateTaskInput): CreateTaskResult {
    const title = input.title.trim();
    if (!title) return { ok: false, reason: 'empty_title' };

    let parentId: string | null = null;
    if (input.parent !== undefined && !isNoParent(input.parent)) {
      const parent = lookup(input.parent, 'parent');
      if (!parent.ok) return parent;
      parentId = parent.task.id;
    }

    let assigneeId: TeamMemberId | null = null;
    if (input.assignee !== undefined) {
      const resolved = resolveAssignee(input.assignee);
      if (resolved === undefined)
        return { ok: false, reason: 'unknown_assignee', query: input.assignee };
      assigneeId = resolved;
    }

    let urgency: TaskUrgency = 'normal';
    if (input.urgency !== undefined) {
      const resolved = resolveUrgency(input.urgency);
      if (!resolved)
        return { ok: false, reason: 'unknown_urgency', query: input.urgency };
      urgency = resolved;
    }

    const task: ProjectTask = {
      id: `TL-${state.nextNumber}`,
      title,
      description: input.description?.trim() ?? '',
      parentId,
      assigneeId,
      urgency,
      status: 'todo',
      sourceFeedback: cleanSourceFeedback(input.source),
    };
    setState({
      ...state,
      tasks: [...state.tasks, task],
      nextNumber: state.nextNumber + 1,
    });
    return { ok: true, task };
  },

  updateTask(
    reference: string,
    changes: { readonly title?: string; readonly description?: string },
  ): TaskChange {
    const title = changes.title?.trim();
    if (title !== undefined && !title)
      return { ok: false, reason: 'empty_title' };
    const found = lookup(reference, 'task');
    if (!found.ok) return found;
    return replaceTask(found.task, {
      ...(title !== undefined ? { title } : {}),
      ...(changes.description !== undefined
        ? { description: changes.description.trim() }
        : {}),
    });
  },

  setParent(reference: string, parentReference: string): TaskChange {
    const found = lookup(reference, 'task');
    if (!found.ok) return found;
    if (isNoParent(parentReference))
      return replaceTask(found.task, { parentId: null });
    const parent = lookup(parentReference, 'parent');
    if (!parent.ok) return parent;
    if (
      parent.task.id === found.task.id ||
      descendantIds(found.task.id).has(parent.task.id)
    ) {
      return {
        ok: false,
        reason: 'cycle',
        task: found.task,
        parent: parent.task,
      };
    }
    return replaceTask(found.task, { parentId: parent.task.id });
  },

  assignTask(reference: string, assignee: string): TaskChange {
    const found = lookup(reference, 'task');
    if (!found.ok) return found;
    const assigneeId = resolveAssignee(assignee);
    if (assigneeId === undefined)
      return { ok: false, reason: 'unknown_assignee', query: assignee };
    return replaceTask(found.task, { assigneeId });
  },

  setUrgency(reference: string, urgency: string): TaskChange {
    const found = lookup(reference, 'task');
    if (!found.ok) return found;
    const resolved = resolveUrgency(urgency);
    if (!resolved)
      return { ok: false, reason: 'unknown_urgency', query: urgency };
    return replaceTask(found.task, { urgency: resolved });
  },

  setStatus(reference: string, status: string): TaskChange {
    const found = lookup(reference, 'task');
    if (!found.ok) return found;
    const resolved = resolveStatus(status);
    if (!resolved)
      return { ok: false, reason: 'unknown_status', query: status };
    return replaceTask(found.task, { status: resolved });
  },

  /**
   * Puts a task in Chris's priorities at a 1-based position, or at the end.
   * A task already in the list moves to the position.
   */
  addToMyPriorities(reference: string, position?: number): PriorityChange {
    if (position !== undefined && (!Number.isInteger(position) || position < 1))
      return { ok: false, reason: 'bad_position', position };
    const found = lookup(reference, 'task');
    if (!found.ok) return found;
    const { task } = found;
    const current = state.myPriorities.indexOf(task.id);
    const previousPosition = current === -1 ? null : current + 1;
    if (position === undefined && previousPosition !== null)
      return {
        ok: true,
        changed: false,
        task,
        position: previousPosition,
        previousPosition,
      };

    const others = state.myPriorities.filter((id) => id !== task.id);
    const index =
      position === undefined
        ? others.length
        : Math.min(position - 1, others.length);
    const next = [...others.slice(0, index), task.id, ...others.slice(index)];
    const changed =
      next.some((id, i) => id !== state.myPriorities[i]) ||
      next.length !== state.myPriorities.length;
    if (changed) setState({ ...state, myPriorities: next });
    return { ok: true, changed, task, position: index + 1, previousPosition };
  },

  removeFromMyPriorities(reference: string): PriorityChange {
    const found = lookup(reference, 'task');
    if (!found.ok) return found;
    const index = state.myPriorities.indexOf(found.task.id);
    if (index === -1)
      return { ok: false, reason: 'not_in_priorities', task: found.task };
    setState({
      ...state,
      myPriorities: state.myPriorities.filter((id) => id !== found.task.id),
    });
    return {
      ok: true,
      changed: true,
      task: found.task,
      position: index + 1,
      previousPosition: index + 1,
    };
  },

  /** Removes a task. Its children move to the top level rather than being removed. */
  removeTask(reference: string): RemoveTaskResult {
    const found = lookup(reference, 'task');
    if (!found.ok) return found;
    const { task } = found;
    let reparentedChildren = 0;
    const tasks = state.tasks.flatMap((candidate) => {
      if (candidate.id === task.id) return [];
      if (candidate.parentId !== task.id) return [candidate];
      reparentedChildren++;
      return [{ ...candidate, parentId: null }];
    });
    const source =
      task.sourceFeedback === null
        ? null
        : normalizeFeedbackQuote(task.sourceFeedback);
    setState({
      ...state,
      tasks,
      myPriorities: state.myPriorities.filter((id) => id !== task.id),
      removedSourceFeedback:
        source === null || state.removedSourceFeedback.includes(source)
          ? state.removedSourceFeedback
          : [...state.removedSourceFeedback, source],
    });
    return { ok: true, task, reparentedChildren };
  },
};

/** A message the Planner can recover from, naming the valid choices. */
export function describeTaskFailure(failure: TaskFailure): string {
  switch (failure.reason) {
    case 'empty_title':
      return 'A task title cannot be empty.';
    case 'task_not_found':
      return `No task matches "${failure.query}". Current tasks: ${listTasks()}`;
    case 'parent_not_found':
      return `No parent task matches "${failure.query}". Current tasks: ${listTasks()}, or ${NO_PARENT} for the top level`;
    case 'ambiguous_task':
    case 'ambiguous_parent':
      return `"${failure.query}" matches more than one task: ${failure.candidates.join(', ')}. Pass the task id.`;
    case 'cycle':
      return failure.task.id === failure.parent.id
        ? `${failure.task.id} cannot be its own parent.`
        : `${failure.parent.id} is inside ${failure.task.id}, so it cannot become its parent.`;
    case 'unknown_assignee':
      return `No team member matches "${failure.query}". Team ids: ${describeTeamChoices()}`;
    case 'unknown_urgency':
      return `Urgency must be one of ${TASK_URGENCIES.join(', ')}, got "${failure.query}".`;
    case 'unknown_status':
      return `Status must be one of ${TASK_STATUSES.join(', ')}, got "${failure.query}".`;
    case 'bad_position':
      return `Priority position must be a whole number of at least 1, got ${failure.position}.`;
    case 'not_in_priorities':
      return `${failure.task.id} ${failure.task.title} is not in your priorities.`;
    case 'stale_reference':
      return `"${failure.query}" is out of date. ${failure.task.id} is now "${taskReferenceLabel(failure.task)}". Use the current reference.`;
  }
}

function lookup(
  reference: string,
  role: 'task' | 'parent',
): { readonly ok: true; readonly task: ProjectTask } | TaskFailure {
  const match = resolveTaskReference(reference);
  if (match.kind === 'found') return { ok: true, task: match.task };
  if (match.kind === 'stale')
    return {
      ok: false,
      reason: 'stale_reference',
      role,
      query: reference,
      task: match.task,
    };
  if (match.kind === 'ambiguous') {
    return {
      ok: false,
      reason: role === 'task' ? 'ambiguous_task' : 'ambiguous_parent',
      query: reference,
      candidates: match.candidates,
    };
  }
  return {
    ok: false,
    reason: role === 'task' ? 'task_not_found' : 'parent_not_found',
    query: reference,
  };
}

function replaceTask(
  task: ProjectTask,
  changes: Partial<Omit<ProjectTask, 'id'>>,
): TaskChange {
  const next: ProjectTask = { ...task, ...changes };
  const changed = (Object.keys(changes) as (keyof ProjectTask)[]).some(
    (key) => next[key] !== task[key],
  );
  if (!changed) return { ok: true, changed: false, task, previous: task };
  setState({
    ...state,
    tasks: state.tasks.map((candidate) =>
      candidate.id === task.id ? next : candidate,
    ),
  });
  return { ok: true, changed: true, task: next, previous: task };
}

function publishedTitle(title: string): string {
  const clean = title
    .replace(UNSAFE_LABEL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > PUBLISHED_TITLE_LIMIT
    ? `${clean.slice(0, PUBLISHED_TITLE_LIMIT).trimEnd()}...`
    : clean;
}

function cleanSourceFeedback(source: string | undefined): string | null {
  if (source === undefined) return null;
  const clean = source
    .replace(UNSAFE_LABEL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  return clean.length > SOURCE_FEEDBACK_LIMIT
    ? `${clean.slice(0, SOURCE_FEEDBACK_LIMIT).trimEnd()}...`
    : clean;
}

function matchFrom(tasks: readonly ProjectTask[]): TaskReferenceMatch {
  if (tasks.length === 0) return { kind: 'not_found' };
  if (tasks.length > 1)
    return { kind: 'ambiguous', candidates: tasks.map((task) => task.id) };
  return { kind: 'found', task: tasks[0] as ProjectTask };
}

function findByFuzzyTitle(
  wanted: string,
  tasks: readonly ProjectTask[],
): ProjectTask[] {
  if (!wanted) return [];
  return tasks.filter((task) => {
    const title = normalizeTitle(task.title);
    return title.includes(wanted) || wanted.includes(title);
  });
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/["'“”‘’.,!?:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoParent(reference: string): boolean {
  return NO_PARENT_WORDS.has(reference.trim().toLowerCase());
}

function resolveUrgency(urgency: string): TaskUrgency | undefined {
  const wanted = urgency.trim().toLowerCase();
  return TASK_URGENCIES.find((candidate) => candidate === wanted);
}

function resolveStatus(status: string): TaskStatus | undefined {
  const wanted = status.trim().toLowerCase();
  return isTaskStatus(wanted) ? wanted : undefined;
}

function listTasks(): string {
  if (state.tasks.length === 0) return '(no tasks yet)';
  const listed = state.tasks
    .slice(0, MAX_LISTED_TASKS)
    .map((task) => `${task.id} ${task.title}`);
  const more = state.tasks.length - listed.length;
  return more > 0 ? `${listed.join(', ')} and ${more} more` : listed.join(', ');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: ProjectTasksState): void {
  state = next;
  for (const listener of listeners) listener();
}
