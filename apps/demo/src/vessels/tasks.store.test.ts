import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetTasksStoreForTests,
  getTasksSnapshot,
  resolveTaskReference,
  taskReferenceLabel,
  tasksActions,
} from './tasks.store';

beforeEach(() => {
  __resetTasksStoreForTests();
});

describe('task ids', () => {
  it('seeds T-1 to T-3 with the original titles', () => {
    expect(
      getTasksSnapshot().tasks.map((task) => [task.id, task.title]),
    ).toEqual([
      ['T-1', 'Setup CI pipeline'],
      ['T-2', 'Prep design review notes'],
      ['T-3', 'Ship this sprint'],
    ]);
  });

  it('numbers new tasks sequentially and subtasks under their task', () => {
    const first = tasksActions.addTask('Prepare design review', [
      'Check prototype',
      'Write questions',
    ]);
    const second = tasksActions.addTask('Book a room');

    expect(first.ok && first.task.id).toBe('T-4');
    expect(first.ok && first.task.subtasks.map((s) => s.id)).toEqual([
      'T-4.1',
      'T-4.2',
    ]);
    expect(second.ok && second.task.id).toBe('T-5');
  });

  it('restarts numbering after a reset', () => {
    tasksActions.addTask('Book a room');
    __resetTasksStoreForTests();
    const result = tasksActions.addTask('Book a room');
    expect(result.ok && result.task.id).toBe('T-4');
  });
});

describe('tasksActions.addTask', () => {
  it('creates the task and its subtasks in one change', () => {
    const before = getTasksSnapshot();
    const result = tasksActions.addTask('Prepare design review', [
      'Check prototype',
      'Write questions',
    ]);

    expect(result).toMatchObject({ ok: true, changed: true });
    const after = getTasksSnapshot();
    expect(after).not.toBe(before);
    expect(after.tasks.at(-1)).toEqual({
      id: 'T-4',
      title: 'Prepare design review',
      done: false,
      subtasks: [
        { id: 'T-4.1', title: 'Check prototype', done: false },
        { id: 'T-4.2', title: 'Write questions', done: false },
      ],
    });
  });

  it('ignores blank subtask titles', () => {
    const result = tasksActions.addTask('Prepare design review', [
      ' Check prototype ',
      '  ',
    ]);
    expect(result.ok && result.task.subtasks.map((s) => s.title)).toEqual([
      'Check prototype',
    ]);
  });
});

describe('resolveTaskReference', () => {
  beforeEach(() => {
    tasksActions.addTask('Prepare design review', [
      'Check prototype',
      'Write questions',
    ]);
  });

  it('resolves a task by id', () => {
    const match = resolveTaskReference(getTasksSnapshot().tasks, 'T-2', 'task');
    expect(match?.task.title).toBe('Prep design review notes');
  });

  it('resolves a task by its full published label', () => {
    const match = resolveTaskReference(
      getTasksSnapshot().tasks,
      'T-2 Prep design review notes (open)',
      'task',
    );
    expect(match?.task.id).toBe('T-2');
  });

  it('resolves a task by fuzzy title', () => {
    const match = resolveTaskReference(
      getTasksSnapshot().tasks,
      'ship this',
      'task',
    );
    expect(match?.task.id).toBe('T-3');
  });

  it('resolves a subtask by id, label and title', () => {
    const tasks = getTasksSnapshot().tasks;
    expect(
      resolveTaskReference(tasks, 'T-4.2', 'subtask')?.subtask?.title,
    ).toBe('Write questions');
    expect(
      resolveTaskReference(tasks, 'T-4.1 Check prototype (open)', 'subtask')
        ?.subtask?.id,
    ).toBe('T-4.1');
    expect(
      resolveTaskReference(tasks, 'check prototype', 'subtask')?.subtask?.id,
    ).toBe('T-4.1');
  });

  it('does not resolve a subtask id as a task or a task id as a subtask', () => {
    const tasks = getTasksSnapshot().tasks;
    expect(resolveTaskReference(tasks, 'T-4.1', 'task')).toBeUndefined();
    expect(resolveTaskReference(tasks, 'T-4', 'subtask')).toBeUndefined();
  });

  it('returns undefined for an unknown id instead of falling back to a title', () => {
    expect(
      resolveTaskReference(getTasksSnapshot().tasks, 'T-99', 'task'),
    ).toBeUndefined();
  });
});

describe('resolveTaskReference with id-like titles', () => {
  it('matches a title that starts like an id instead of the id it resembles', () => {
    tasksActions.addTask('T-2 retro follow-up', ['T-2.1 notes']);
    const { tasks } = getTasksSnapshot();
    expect(
      resolveTaskReference(tasks, 'T-2 retro follow-up', 'task')?.task.id,
    ).toBe('T-4');
    expect(
      resolveTaskReference(tasks, 'T-4 T-2 retro follow-up (open)', 'task')
        ?.task.id,
    ).toBe('T-4');
    expect(
      resolveTaskReference(tasks, 'T-2 Prep design review notes (open)', 'task')
        ?.task.id,
    ).toBe('T-2');
    expect(
      resolveTaskReference(tasks, 'T-2.1 notes', 'subtask')?.subtask?.id,
    ).toBe('T-4.1');
  });

  it('finds a title that starts with an unknown id', () => {
    tasksActions.addTask('T-99 cleanup');
    expect(
      resolveTaskReference(getTasksSnapshot().tasks, 'T-99 cleanup', 'task')
        ?.task.id,
    ).toBe('T-4');
  });
});

describe('taskReferenceLabel', () => {
  it('formats id, title and status', () => {
    expect(
      taskReferenceLabel({ id: 'T-4.1', title: 'Check prototype', done: true }),
    ).toBe('T-4.1 Check prototype (done)');
    expect(
      taskReferenceLabel({ id: 'T-2', title: 'Prep notes', done: false }),
    ).toBe('T-2 Prep notes (open)');
  });
});

describe('tasksActions.setSubtaskDone', () => {
  beforeEach(() => {
    tasksActions.addTask('Prepare design review', [
      'Check prototype',
      'Write questions',
    ]);
  });

  it('marks the subtask done and reports the change', () => {
    const result = tasksActions.setSubtaskDone('T-4.1', true);
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      subtask: { id: 'T-4.1', done: true },
    });
    const task = getTasksSnapshot().tasks.find((t) => t.id === 'T-4');
    expect(task?.subtasks.map((s) => s.done)).toEqual([true, false]);
  });

  it('reports no change when the subtask already has that state', () => {
    tasksActions.setSubtaskDone('T-4.1', true);
    const before = getTasksSnapshot();
    const result = tasksActions.setSubtaskDone('T-4.1', true);
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(getTasksSnapshot()).toBe(before);
  });

  it('reports not_found with the query for an unknown subtask', () => {
    expect(tasksActions.setSubtaskDone('gym', true)).toEqual({
      ok: false,
      reason: 'not_found',
      query: 'gym',
    });
  });
});

describe('task mutations', () => {
  it('checks and unchecks a task by reference', () => {
    expect(tasksActions.setTaskDone('T-2', true)).toMatchObject({
      ok: true,
      changed: true,
      task: { id: 'T-2', done: true },
    });
    expect(tasksActions.setTaskDone('T-2', false)).toMatchObject({
      ok: true,
      changed: true,
      task: { id: 'T-2', done: false },
    });
  });

  it('removes a task by reference', () => {
    expect(tasksActions.removeTask('Ship this sprint')).toMatchObject({
      ok: true,
      task: { id: 'T-3' },
    });
    expect(getTasksSnapshot().tasks.map((t) => t.id)).toEqual(['T-1', 'T-2']);
  });

  it('adds a subtask under a task by reference', () => {
    const result = tasksActions.addSubtask('T-2', 'Draft agenda');
    expect(result).toMatchObject({
      ok: true,
      subtask: { id: 'T-2.1', title: 'Draft agenda', done: false },
    });
  });

  it('refuses a blank subtask title without changing the task', () => {
    const before = getTasksSnapshot();
    expect(tasksActions.addSubtask('T-2', '   ')).toEqual({
      ok: false,
      reason: 'blank_title',
      query: '   ',
    });
    expect(getTasksSnapshot()).toBe(before);
  });

  it('returns not_found results instead of booleans', () => {
    expect(tasksActions.removeTask('gym')).toEqual({
      ok: false,
      reason: 'not_found',
      query: 'gym',
    });
    expect(tasksActions.setTaskDone('gym', true)).toEqual({
      ok: false,
      reason: 'not_found',
      query: 'gym',
    });
    expect(tasksActions.addSubtask('gym', 'Stretch')).toEqual({
      ok: false,
      reason: 'not_found',
      query: 'gym',
    });
  });
});
