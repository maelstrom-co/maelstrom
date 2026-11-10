import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetBoardFilterStoreForTests,
  boardFilterActions,
} from './stores/board-filter.store';
import {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
  projectTaskActions,
  taskReferenceLabel,
} from './stores/project-tasks.store';
import {
  __resetTaskDetailStoreForTests,
  openTaskDetail,
} from './stores/task-detail.store';
import {
  reportBoardFilter,
  reportShowTask,
  reportTaskChange,
} from './task-action-receipts';
import {
  __resetTasklaneActivityForTests,
  getLatestReceipt,
} from './tasklane-activity';

beforeEach(() => {
  __resetProjectTasksStoreForTests();
  __resetTasklaneActivityForTests();
  __resetTaskDetailStoreForTests();
  __resetBoardFilterStoreForTests();
});

describe('stale reference receipts', () => {
  it('blames the parent, not the moved task, when the parent reference is stale', () => {
    const readme = getProjectTasksSnapshot().tasks[0];
    if (!readme) throw new Error('missing seed task');
    const staleParent = taskReferenceLabel(readme);
    projectTaskActions.assignTask('TL-1', 'sam');

    reportTaskChange(
      'setParent',
      projectTaskActions.setParent('TL-2', staleParent),
    );

    expect(getLatestReceipt()?.text).toMatch(
      /^✗ Couldn't use "Update demo README" as the parent because it changed: now /,
    );
  });
});

describe('showTask receipts', () => {
  it('records nothing when a task opens, since opening changes no data', () => {
    expect(reportShowTask(openTaskDetail('detail-1', 'TL-1')).ok).toBe(true);
    expect(getLatestReceipt()).toBeNull();
  });

  it('reports a task it could not find', () => {
    const result = reportShowTask(openTaskDetail('detail-1', 'Ghost'));
    expect(result.ok).toBe(false);
    expect(getLatestReceipt()?.text).toBe(
      '✗ Couldn\'t find a task matching "Ghost"',
    );
  });

  it('confirms reopening the task already open, so an earlier failure line does not linger', () => {
    reportShowTask(openTaskDetail('detail-1', 'TL-1'));
    reportShowTask(openTaskDetail('detail-1', 'Ghost'));
    expect(getLatestReceipt()?.tone).toBe('problem');
    expect(reportShowTask(openTaskDetail('detail-1', 'TL-1')).ok).toBe(true);
    expect(getLatestReceipt()).toBeNull();
  });
});

describe('board filter receipts', () => {
  it('records nothing when a filter applies, since filtering changes no data', () => {
    expect(
      reportBoardFilter(boardFilterActions.filterByAssignee('alex')).ok,
    ).toBe(true);
    expect(getLatestReceipt()).toBeNull();
  });

  it('reports a team member it could not find', () => {
    const result = reportBoardFilter(
      boardFilterActions.filterByAssignee('robin'),
    );
    expect(result.ok).toBe(false);
    expect(getLatestReceipt()?.text).toBe(
      '✗ Couldn\'t find a team member called "robin"',
    );
  });

  it('confirms repeating the active filter, so an earlier failure line does not linger', () => {
    reportBoardFilter(boardFilterActions.filterByAssignee('alex'));
    reportBoardFilter(boardFilterActions.filterByAssignee('robin'));
    expect(getLatestReceipt()?.tone).toBe('problem');
    expect(
      reportBoardFilter(boardFilterActions.filterByAssignee('alex')).ok,
    ).toBe(true);
    expect(getLatestReceipt()).toBeNull();
  });
});

describe('status receipts', () => {
  it('marks a task as done, in progress or to do', () => {
    reportTaskChange('setStatus', projectTaskActions.setStatus('TL-1', 'done'));
    expect(getLatestReceipt()?.text).toBe(
      '✓ Marked "Update demo README" as done',
    );
    reportTaskChange(
      'setStatus',
      projectTaskActions.setStatus('TL-1', 'doing'),
    );
    expect(getLatestReceipt()?.text).toBe(
      '✓ Marked "Update demo README" as in progress',
    );
    reportTaskChange('setStatus', projectTaskActions.setStatus('TL-1', 'todo'));
    expect(getLatestReceipt()?.text).toBe(
      '✓ Marked "Update demo README" as to do',
    );
  });

  it('confirms a status the task already has, so an earlier failure line does not linger', () => {
    reportTaskChange(
      'setStatus',
      projectTaskActions.setStatus('TL-1', 'later'),
    );
    expect(getLatestReceipt()?.tone).toBe('problem');
    expect(
      reportTaskChange(
        'setStatus',
        projectTaskActions.setStatus('TL-1', 'todo'),
      ).ok,
    ).toBe(true);
    expect(getLatestReceipt()).toBeNull();
  });

  it('names an unknown status in the failure receipt', () => {
    const result = reportTaskChange(
      'setStatus',
      projectTaskActions.setStatus('TL-1', 'blocked'),
    );
    expect(result.ok).toBe(false);
    expect(getLatestReceipt()?.text).toBe(
      '✗ Couldn\'t set the status to "blocked"',
    );
  });
});
