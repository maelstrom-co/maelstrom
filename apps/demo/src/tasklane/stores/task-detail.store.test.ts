import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetTaskDetailStoreForTests,
  getTaskDetailSnapshot,
  selectedTaskId,
  taskDetailActions,
} from './task-detail.store';

beforeEach(() => {
  __resetTaskDetailStoreForTests();
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
