import { nanoid } from 'nanoid';
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

const SEED_TASKS: Task[] = [
  { id: '1', title: 'Setup CI pipeline', done: true, subtasks: [] },
  { id: '2', title: 'Prep design review notes', done: false, subtasks: [] },
  { id: '3', title: 'Ship this sprint', done: false, subtasks: [] },
];

let state: TasksState = { tasks: SEED_TASKS };

const listeners = new Set<() => void>();

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

export function useTasksStore(): TasksState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getTasksSnapshot(): TasksState {
  return state;
}

// Test-only: restores the module-singleton store to its seeded state so
// specs don't leak mutations into one another.
export function __resetTasksStoreForTests(): void {
  setState({
    tasks: SEED_TASKS.map((t) => ({ ...t, subtasks: [...t.subtasks] })),
  });
}

export const tasksActions = {
  addTask(title: string): void {
    setState({
      tasks: [
        ...state.tasks,
        { id: nanoid(), title, done: false, subtasks: [] },
      ],
    });
  },
  removeTask(title: string): boolean {
    const match = findByFuzzyTitle(state.tasks, title);
    if (!match) return false;
    setState({
      tasks: state.tasks.filter((t) => t.id !== match.id),
    });
    return true;
  },
  checkTask(title: string): boolean {
    const match = findByFuzzyTitle(state.tasks, title);
    if (!match) return false;
    setState({
      tasks: state.tasks.map((t) =>
        t.id === match.id ? { ...t, done: true } : t,
      ),
    });
    return true;
  },
  uncheckTask(title: string): boolean {
    const match = findByFuzzyTitle(state.tasks, title);
    if (!match) return false;
    setState({
      tasks: state.tasks.map((t) =>
        t.id === match.id ? { ...t, done: false } : t,
      ),
    });
    return true;
  },
  addSubtask(taskTitle: string, subtaskTitle: string): boolean {
    const match = findByFuzzyTitle(state.tasks, taskTitle);
    if (!match) return false;
    setState({
      tasks: state.tasks.map((t) =>
        t.id === match.id
          ? {
              ...t,
              subtasks: [
                ...t.subtasks,
                { id: nanoid(), title: subtaskTitle, done: false },
              ],
            }
          : t,
      ),
    });
    return true;
  },
};
