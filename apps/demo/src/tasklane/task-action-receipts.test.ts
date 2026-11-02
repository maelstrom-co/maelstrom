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
