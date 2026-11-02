import { useSyncExternalStore } from 'react';
import { findByFuzzyTitle } from './find-by-fuzzy-title';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
  subtasks: Subtask[];
}

interface TasksState {
  tasks: Task[];
}

export interface NotFound {
  ok: false;
  reason: 'not_found';
  query: string;
}

export type TaskChange = { ok: true; changed: boolean; task: Task } | NotFound;

export interface BlankTitle {
  ok: false;
  reason: 'blank_title';
  query: string;
}

export type SubtaskChange =
  | { ok: true; changed: boolean; task: Task; subtask: Subtask }
  | NotFound
  | BlankTitle;

export interface TaskReferenceMatch {
  task: Task;
  subtask?: Subtask;
}

const SEED_TASKS: readonly Task[] = [
  { id: 'T-1', title: 'Setup CI pipeline', done: true, subtasks: [] },
  { id: 'T-2', title: 'Prep design review notes', done: false, subtasks: [] },
  { id: 'T-3', title: 'Ship this sprint', done: false, subtasks: [] },
];

let state: TasksState = { tasks: seedTasks() };
let nextTaskNumber = SEED_TASKS.length + 1;

const listeners = new Set<() => void>();

export function useTasksStore(): TasksState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getTasksSnapshot(): TasksState {
  return state;
}

// Test-only: restores the module-singleton store to its seeded state so
// specs don't leak mutations into one another.
export function __resetTasksStoreForTests(): void {
  nextTaskNumber = SEED_TASKS.length + 1;
  setState({ tasks: seedTasks() });
}

/** The reference published to the Planner and accepted back by every lookup. */
export function taskReferenceLabel(item: Subtask | Task): string {
  return `${item.id} ${item.title} (${item.done ? 'done' : 'open'})`;
}

/**
 * Resolves an id (`T-2`, `T-4.1`), a published label
 * (`T-2 Prep design review notes (open)`) or a title. A bare id that names
 * nothing never falls back to a title match.
 */
export function resolveTaskReference(
  tasks: readonly Task[],
  reference: string,
  kind: 'task' | 'subtask',
): TaskReferenceMatch | undefined {
  const trimmed = reference.trim();
  const id = TASK_ID_PATTERN.exec(trimmed)?.[1];
  if (id) {
    const byId = findTaskById(tasks, id, kind);
    const rest = trimmed
      .slice(id.length)
      .trim()
      .replace(STATUS_SUFFIX_PATTERN, '');
    if (!rest) return byId;
    // A title may itself start like an id, so the prefix counts only when
    // the rest names that same item.
    const named = byId?.subtask ?? byId?.task;
    if (named && named.title.toLowerCase() === rest.toLowerCase()) return byId;
  }

  const title = trimmed.replace(STATUS_SUFFIX_PATTERN, '');
  if (kind === 'task') {
    const task = findByFuzzyTitle([...tasks], title);
    return task ? { task } : undefined;
  }
  const subtasks = tasks.flatMap((task) =>
    task.subtasks.map((subtask) => ({ ...subtask, task })),
  );
  const match = findByFuzzyTitle(subtasks, title);
  if (!match) return undefined;
  const subtask = match.task.subtasks.find((s) => s.id === match.id);
  return subtask ? { task: match.task, subtask } : undefined;
}

export const tasksActions = {
  addTask(
    title: string,
    subtaskTitles: readonly string[] = [],
  ): { ok: true; changed: true; task: Task } {
    const id = `T-${nextTaskNumber++}`;
    const task: Task = {
      id,
      title: title.trim(),
      done: false,
      subtasks: subtaskTitles
        .map((subtaskTitle) => subtaskTitle.trim())
        .filter((subtaskTitle) => subtaskTitle.length > 0)
        .map((subtaskTitle, index) => ({
          id: `${id}.${index + 1}`,
          title: subtaskTitle,
          done: false,
        })),
    };
    setState({ tasks: [...state.tasks, task] });
    return { ok: true, changed: true, task };
  },
  removeTask(reference: string): TaskChange {
    const match = resolveTaskReference(state.tasks, reference, 'task');
    if (!match) return notFound(reference);
    setState({ tasks: state.tasks.filter((t) => t.id !== match.task.id) });
    return { ok: true, changed: true, task: match.task };
  },
  setTaskDone(reference: string, done: boolean): TaskChange {
    const match = resolveTaskReference(state.tasks, reference, 'task');
    if (!match) return notFound(reference);
    if (match.task.done === done) {
      return { ok: true, changed: false, task: match.task };
    }
    const task = { ...match.task, done };
    replaceTask(task);
    return { ok: true, changed: true, task };
  },
  addSubtask(taskReference: string, subtaskTitle: string): SubtaskChange {
    const match = resolveTaskReference(state.tasks, taskReference, 'task');
    if (!match) return notFound(taskReference);
    const title = subtaskTitle.trim();
    if (!title) {
      return { ok: false, reason: 'blank_title', query: subtaskTitle };
    }
    const subtask: Subtask = {
      id: `${match.task.id}.${match.task.subtasks.length + 1}`,
      title,
      done: false,
    };
    const task = { ...match.task, subtasks: [...match.task.subtasks, subtask] };
    replaceTask(task);
    return { ok: true, changed: true, task, subtask };
  },
  setSubtaskDone(reference: string, done: boolean): SubtaskChange {
    const match = resolveTaskReference(state.tasks, reference, 'subtask');
    if (!match?.subtask) return notFound(reference);
    if (match.subtask.done === done) {
      return {
        ok: true,
        changed: false,
        task: match.task,
        subtask: match.subtask,
      };
    }
    const subtask = { ...match.subtask, done };
    const task = {
      ...match.task,
      subtasks: match.task.subtasks.map((s) =>
        s.id === subtask.id ? subtask : s,
      ),
    };
    replaceTask(task);
    return { ok: true, changed: true, task, subtask };
  },
};

const TASK_ID_PATTERN = /^(T-\d+(?:\.\d+)?)(?:\s|$)/;
const STATUS_SUFFIX_PATTERN = /\s*\((?:open|done)\)$/;

function findTaskById(
  tasks: readonly Task[],
  id: string,
  kind: 'task' | 'subtask',
): TaskReferenceMatch | undefined {
  if (id.includes('.') !== (kind === 'subtask')) return undefined;
  for (const task of tasks) {
    if (task.id === id) return { task };
    const subtask = task.subtasks.find((s) => s.id === id);
    if (subtask) return { task, subtask };
  }
  return undefined;
}

function seedTasks(): Task[] {
  return SEED_TASKS.map((task) => ({ ...task, subtasks: [] }));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): TasksState {
  return state;
}

function setState(next: TasksState): void {
  state = next;
  for (const l of listeners) l();
}

function replaceTask(task: Task): void {
  setState({ tasks: state.tasks.map((t) => (t.id === task.id ? task : t)) });
}

function notFound(query: string): NotFound {
  return { ok: false, reason: 'not_found', query };
}
