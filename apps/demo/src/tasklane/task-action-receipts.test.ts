import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
  projectTaskActions,
  taskReferenceLabel,
} from './stores/project-tasks.store';
import { reportTaskChange } from './task-action-receipts';
import {
  __resetTasklaneActivityForTests,
  getLatestReceipt,
} from './tasklane-activity';

beforeEach(() => {
  __resetProjectTasksStoreForTests();
  __resetTasklaneActivityForTests();
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
