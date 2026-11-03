import { useSyncExternalStore } from 'react';

/**
 * Which task each Task detail Instance shows, keyed by instanceId. The
 * protocol carries no per-Instance props, so an Action sets this instead.
 */
export type TaskDetailSelection = ReadonlyMap<string, string>;

const INITIAL_STATE: TaskDetailSelection = new Map();

let state: TaskDetailSelection = INITIAL_STATE;

const listeners = new Set<() => void>();

export function useTaskDetailStore(): TaskDetailSelection {
  return useSyncExternalStore(
    subscribe,
    getTaskDetailSnapshot,
    getTaskDetailSnapshot,
  );
}

/** The task id one Instance shows, or null. */
export function useSelectedTaskId(instanceId: string): string | null {
  return useTaskDetailStore().get(instanceId) ?? null;
}

export function getTaskDetailSnapshot(): TaskDetailSelection {
  return state;
}

export function selectedTaskId(instanceId: string): string | null {
  return state.get(instanceId) ?? null;
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

  clearTask(instanceId: string): boolean {
    if (!state.has(instanceId)) return false;
    const next = new Map(state);
    next.delete(instanceId);
    setState(next);
    return true;
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: TaskDetailSelection): void {
  state = next;
  for (const listener of listeners) listener();
}
