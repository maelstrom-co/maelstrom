import { useSyncExternalStore } from 'react';
import {
  type ProjectTask,
  resolveTaskReference,
  type TaskLookupFailure,
} from './project-tasks.store';

/**
 * Which task each Task detail Instance shows, keyed by instanceId. The
 * protocol carries no per-Instance props, so an Action sets this instead. A
 * selected id can outlive its task, which the Vessel shows as deleted.
 */
export type TaskDetailSelection = ReadonlyMap<string, string>;

export type OpenTaskDetailResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly task: ProjectTask;
    }
  | TaskLookupFailure;

const INITIAL_STATE: TaskDetailSelection = new Map();

let state: TaskDetailSelection = INITIAL_STATE;

const listeners = new Set<() => void>();

/** The task id one Instance shows, or null. */
export function useSelectedTaskId(instanceId: string): string | null {
  return useTaskDetailStore().get(instanceId) ?? null;
}

export function getTaskDetailSnapshot(): TaskDetailSelection {
  return state;
}

export function __resetTaskDetailStoreForTests(): void {
  setState(INITIAL_STATE);
}

export const taskDetailActions = {
  /** Points one Instance at a task. Returns whether the selection changed. */
  showTask(instanceId: string, taskId: string): boolean {
    if (state.get(instanceId) === taskId) return false;
    const next = new Map(state);
    next.set(instanceId, taskId);
    setState(next);
    return true;
  },

  /** Forgets the task one Instance shows. */
  clearTask(instanceId: string): boolean {
    if (!state.has(instanceId)) return false;
    const next = new Map(state);
    next.delete(instanceId);
    setState(next);
    return true;
  },

  /**
   * Forgets the selection of every Instance not in `liveInstanceIds`, so a
   * later Instance that reuses an id starts empty. Returns whether anything
   * was forgotten.
   */
  keepInstances(liveInstanceIds: ReadonlySet<string>): boolean {
    const next = new Map(
      [...state].filter(([instanceId]) => liveInstanceIds.has(instanceId)),
    );
    if (next.size === state.size) return false;
    setState(next);
    return true;
  },
};

/**
 * Resolves a task reference and points one Instance at it. Opening a task
 * reads no field the label could have changed, so a label that went stale
 * since it was published still opens its task.
 */
export function openTaskDetail(
  instanceId: string,
  reference: string,
): OpenTaskDetailResult {
  const match = resolveTaskReference(reference);
  if (match.kind === 'not_found')
    return { ok: false, reason: 'task_not_found', query: reference };
  if (match.kind === 'ambiguous')
    return {
      ok: false,
      reason: 'ambiguous_task',
      query: reference,
      candidates: match.candidates,
    };
  const changed = taskDetailActions.showTask(instanceId, match.task.id);
  return { ok: true, changed, task: match.task };
}

function useTaskDetailStore(): TaskDetailSelection {
  return useSyncExternalStore(
    subscribe,
    getTaskDetailSnapshot,
    getTaskDetailSnapshot,
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: TaskDetailSelection): void {
  state = next;
  for (const listener of listeners) listener();
}
