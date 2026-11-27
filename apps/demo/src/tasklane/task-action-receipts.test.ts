import { ActionName, InstanceId } from '@maelstrom-co/protocol';
import type { ActionResult } from '@maelstrom-co/react';
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
import { type ReceiptLine, summariseReceipt } from './tasklane-activity';

beforeEach(() => {
  __resetProjectTasksStoreForTests();
  __resetTaskDetailStoreForTests();
  __resetBoardFilterStoreForTests();
});

describe('stale reference receipts', () => {
  it('blames the parent, not the moved task, when the parent reference is stale', () => {
    const readme = getProjectTasksSnapshot().tasks[0];
    if (!readme) throw new Error('missing seed task');
    const staleParent = taskReferenceLabel(readme);
    projectTaskActions.assignTask('TL-1', 'sam');

    const result = reportTaskChange(
      'setParent',
      projectTaskActions.setParent('TL-2', staleParent),
    );

    expect(receiptOf('setParent', result)?.text).toMatch(
      /^✗ Couldn't use "Update demo README" as the parent because it changed: now /,
    );
  });

  it('keeps the Planner guidance after the receipt reason', () => {
    const result = reportTaskChange(
      'setStatus',
      projectTaskActions.setStatus('Ghost', 'done'),
    );
    if (result.ok) throw new Error('expected a failure');
    const [reason, ...guidance] = result.error.message.split('\n');
    expect(reason).toBe('Couldn\'t find a task matching "Ghost"');
    expect(guidance.join('\n')).toContain('TL-1 Update demo README');
  });
});

describe('showTask receipts', () => {
  it('records nothing when a task opens, since opening changes no data', () => {
    const result = reportShowTask(openTaskDetail('detail-1', 'TL-1'));
    expect(result.ok).toBe(true);
    expect(receiptOf('showTask', result)).toBeNull();
  });

  it('reports a task it could not find', () => {
    const result = reportShowTask(openTaskDetail('detail-1', 'Ghost'));
    expect(result.ok).toBe(false);
    expect(receiptOf('showTask', result)?.text).toBe(
      '✗ Couldn\'t find a task matching "Ghost"',
    );
  });

  it('confirms reopening the task already open without a receipt part', () => {
    reportShowTask(openTaskDetail('detail-1', 'TL-1'));
    const result = reportShowTask(openTaskDetail('detail-1', 'TL-1'));
    expect(result.ok).toBe(true);
    expect(receiptOf('showTask', result)).toBeNull();
  });
});

describe('board filter receipts', () => {
  it('records nothing when a filter applies, since filtering changes no data', () => {
    const result = reportBoardFilter(
      boardFilterActions.filterByAssignee('alex'),
    );
    expect(result.ok).toBe(true);
    expect(receiptOf('filterByAssignee', result)).toBeNull();
  });

  it('reports a team member it could not find', () => {
    const result = reportBoardFilter(
      boardFilterActions.filterByAssignee('robin'),
    );
    expect(result.ok).toBe(false);
    expect(receiptOf('filterByAssignee', result)?.text).toBe(
      '✗ Couldn\'t find a team member called "robin"',
    );
  });

  it('confirms repeating the active filter without a receipt part', () => {
    reportBoardFilter(boardFilterActions.filterByAssignee('alex'));
    const result = reportBoardFilter(
      boardFilterActions.filterByAssignee('alex'),
    );
    expect(result.ok).toBe(true);
    expect(receiptOf('filterByAssignee', result)).toBeNull();
  });
});

describe('status receipts', () => {
  it('marks a task as done, in progress or to do', () => {
    expect(
      receiptOf(
        'setStatus',
        reportTaskChange(
          'setStatus',
          projectTaskActions.setStatus('TL-1', 'done'),
        ),
      )?.text,
    ).toBe('✓ Marked "Update demo README" as done');
    expect(
      receiptOf(
        'setStatus',
        reportTaskChange(
          'setStatus',
          projectTaskActions.setStatus('TL-1', 'doing'),
        ),
      )?.text,
    ).toBe('✓ Marked "Update demo README" as in progress');
    expect(
      receiptOf(
        'setStatus',
        reportTaskChange(
          'setStatus',
          projectTaskActions.setStatus('TL-1', 'todo'),
        ),
      )?.text,
    ).toBe('✓ Marked "Update demo README" as to do');
  });

  it('confirms a status the task already has without a receipt part', () => {
    const result = reportTaskChange(
      'setStatus',
      projectTaskActions.setStatus('TL-1', 'todo'),
    );
    expect(result.ok).toBe(true);
    expect(receiptOf('setStatus', result)).toBeNull();
  });

  it('names an unknown status in the failure receipt', () => {
    const result = reportTaskChange(
      'setStatus',
      projectTaskActions.setStatus('TL-1', 'blocked'),
    );
    expect(result.ok).toBe(false);
    expect(receiptOf('setStatus', result)?.text).toBe(
      '✗ Couldn\'t set the status to "blocked"',
    );
  });
});

describe('due date receipts', () => {
  it('reports clearing a task due date', () => {
    projectTaskActions.setDueDate('TL-2', '2026-05-01');
    expect(
      receiptOf(
        'setDueDate',
        reportTaskChange(
          'setDueDate',
          projectTaskActions.setDueDate('TL-2', 'none'),
        ),
      )?.text,
    ).toBe('✓ Cleared the due date on "Record launch video"');
  });

  it('names an invalid due date in the failure receipt and returns a readable error', () => {
    const result = reportTaskChange(
      'setDueDate',
      projectTaskActions.setDueDate('TL-1', 'next Friday'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    const [reason, ...guidance] = result.error.message.split('\n');
    expect(reason).toBe('Couldn\'t set the due date to "next Friday"');
    expect(guidance.join('\n')).toBe(
      'Due date must be an ISO date (YYYY-MM-DD) or "none", got "next Friday".',
    );
    expect(receiptOf('setDueDate', result)?.text).toBe(
      '✗ Couldn\'t set the due date to "next Friday"',
    );
  });
});

function receiptOf(action: string, result: ActionResult): ReceiptLine | null {
  const target = {
    instanceId: InstanceId('project-tasks-main'),
    action: ActionName(action),
  };
  return summariseReceipt({
    id: 'ticket-1',
    intent: 'test',
    status: result.ok ? 'applied' : 'unknown',
    actions: [
      result.ok
        ? {
            ...target,
            status: 'ran',
            ...(result.value === undefined ? {} : { value: result.value }),
          }
        : { ...target, status: 'failed', reason: result.error.message },
    ],
  });
}
