import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
  projectTaskActions,
  taskReferenceLabel,
} from './project-tasks.store';
import {
  __resetTaskDetailStoreForTests,
  getTaskDetailSnapshot,
  openTaskDetail,
  taskDetailActions,
} from './task-detail.store';

beforeEach(() => {
  __resetTaskDetailStoreForTests();
  __resetProjectTasksStoreForTests();
});

describe('task detail selection', () => {
  it('starts with no Instance showing a task', () => {
    expect(getTaskDetailSnapshot().size).toBe(0);
    expect(selectedTaskId('task-detail-1')).toBeNull();
  });

  it('keeps a separate task for each Instance', () => {
    taskDetailActions.showTask('task-detail-1', 'TL-1');
    taskDetailActions.showTask('task-detail-2', 'TL-2');
    expect(selectedTaskId('task-detail-1')).toBe('TL-1');
    expect(selectedTaskId('task-detail-2')).toBe('TL-2');
  });

  it('replaces the snapshot only when a selection changes', () => {
    taskDetailActions.showTask('task-detail-1', 'TL-1');
    const before = getTaskDetailSnapshot();
    expect(taskDetailActions.showTask('task-detail-1', 'TL-1')).toBe(false);
    expect(getTaskDetailSnapshot()).toBe(before);
    expect(taskDetailActions.showTask('task-detail-1', 'TL-2')).toBe(true);
    expect(getTaskDetailSnapshot()).not.toBe(before);
    expect(before.get('task-detail-1')).toBe('TL-1');
  });

  it('clears one Instance without touching the others', () => {
    taskDetailActions.showTask('task-detail-1', 'TL-1');
    taskDetailActions.showTask('task-detail-2', 'TL-2');
    taskDetailActions.clearTask('task-detail-1');
    expect(selectedTaskId('task-detail-1')).toBeNull();
    expect(selectedTaskId('task-detail-2')).toBe('TL-2');
  });
});

describe('openTaskDetail', () => {
  it('resolves an id, a label or a title and points the Instance at the task', () => {
    expect(openTaskDetail('task-detail-1', 'TL-2')).toMatchObject({
      ok: true,
      changed: true,
      task: { id: 'TL-2' },
    });
    expect(openTaskDetail('task-detail-1', 'launch video')).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(openTaskDetail('task-detail-2', 'update demo readme')).toMatchObject(
      { ok: true, task: { id: 'TL-1' } },
    );
    expect(selectedTaskId('task-detail-1')).toBe('TL-2');
    expect(selectedTaskId('task-detail-2')).toBe('TL-1');
  });

  it('still opens a task from a label that changed since it was published', () => {
    const readme = taskReferenceLabel(firstSeedTask());
    projectTaskActions.assignTask('TL-1', 'sam');
    expect(openTaskDetail('task-detail-1', readme)).toMatchObject({
      ok: true,
      task: { id: 'TL-1', assigneeId: 'sam' },
    });
  });

  it('refuses an unknown or ambiguous task and keeps the current selection', () => {
    openTaskDetail('task-detail-1', 'TL-1');
    expect(openTaskDetail('task-detail-1', 'Ghost')).toEqual({
      ok: false,
      reason: 'task_not_found',
      query: 'Ghost',
    });
    projectTaskActions.createTask({ title: 'Demo copy A' });
    projectTaskActions.createTask({ title: 'Demo copy B' });
    expect(openTaskDetail('task-detail-1', 'demo copy')).toEqual({
      ok: false,
      reason: 'ambiguous_task',
      query: 'demo copy',
      candidates: ['TL-3', 'TL-4'],
    });
    expect(selectedTaskId('task-detail-1')).toBe('TL-1');
  });
});

function selectedTaskId(instanceId: string): string | null {
  return getTaskDetailSnapshot().get(instanceId) ?? null;
}

function firstSeedTask() {
  const task = getProjectTasksSnapshot().tasks[0];
  if (!task) throw new Error('expected a seeded task');
  return task;
}
