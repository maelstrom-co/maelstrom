import type { ActionExecution } from '@maelstrom-co/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetActionActivityForTests,
  type ActivityEntry,
  attachExecutionPlan,
  beginRequestWindow,
  describeAddedTask,
  endRequestWindow,
  getActivitySnapshot,
  latestReceiptParts,
  markDirectAction,
  problemSummaryForWindow,
  recordChange,
  recordFailure,
  recordUnchanged,
  summariseReceipt,
} from './action-activity';

const TASKS = { vesselId: 'tasks', action: 'addTask' } as const;

beforeEach(() => {
  __resetActionActivityForTests();
});

describe('summariseReceipt', () => {
  it('renders successes as check marks joined with a middle dot', () => {
    expect(
      summariseReceipt(
        [
          entry('changed', 'Created journal entry "Design review prep"'),
          entry('changed', 'Wrote to "Design review prep"'),
        ],
        null,
      ),
    ).toBe(
      '✓ Created journal entry "Design review prep" · ✓ Wrote to "Design review prep"',
    );
  });

  it('renders failures with a cross and the user-facing reason', () => {
    expect(
      summariseReceipt([entry('failed', 'Couldn\'t find task "gym"')], null),
    ).toBe('✗ Couldn\'t find task "gym"');
  });

  it('renders an already-applied outcome as confirmed without claiming a change', () => {
    expect(
      summariseReceipt(
        [entry('unchanged', '"Setup CI pipeline" was already done')],
        null,
      ),
    ).toBe('✓ "Setup CI pipeline" was already done');
  });

  it('marks a planned data Action without an entry as not confirmed', () => {
    expect(
      summariseReceipt(
        [entry('changed', 'Added "Prepare design review"', 'addTask')],
        [plan('addTask'), plan('checkTask')],
      ),
    ).toBe('✓ Added "Prepare design review" · ? Not confirmed: checkTask');
  });

  it('counts repeated planned Actions against their entries', () => {
    expect(
      summariseReceipt(
        [entry('changed', 'Added "A"', 'addTask')],
        [plan('addTask'), plan('addTask')],
      ),
    ).toBe('✓ Added "A" · ? Not confirmed: addTask');
  });

  it('ignores planned Actions that are not data Actions', () => {
    expect(summariseReceipt([], [plan('openEntry'), plan('setView')])).toBe(
      null,
    );
  });

  it('produces no line for a layout-only window', () => {
    expect(summariseReceipt([], [])).toBeNull();
    expect(summariseReceipt([], null)).toBeNull();
  });
});

describe('describeAddedTask', () => {
  it('pluralises subtasks', () => {
    expect(describeAddedTask('Prepare design review', 2)).toBe(
      'Added "Prepare design review" with 2 subtasks',
    );
    expect(describeAddedTask('Prepare design review', 1)).toBe(
      'Added "Prepare design review" with 1 subtask',
    );
    expect(describeAddedTask('Prepare design review', 0)).toBe(
      'Added "Prepare design review"',
    );
  });
});

describe('activity windows', () => {
  it('gives an entry outside any request its own one-entry window', () => {
    recordChange('Checked subtask "Check prototype"', {
      vesselId: 'tasks',
      action: 'checkSubtask',
    });
    recordChange('Checked task "Ship this sprint"', {
      vesselId: 'tasks',
      action: 'checkTask',
    });
    expect(text(latestReceiptParts(getActivitySnapshot()))).toBe(
      '✓ Checked task "Ship this sprint"',
    );
  });

  it('groups entries recorded during a request into that request', () => {
    const windowId = beginRequestWindow();
    recordChange('Created journal entry "Design review prep"', {
      vesselId: 'journal',
      action: 'createEntry',
    });
    expect(latestReceiptParts(getActivitySnapshot())).toEqual([]);
    recordChange('Wrote to "Design review prep"', {
      vesselId: 'journal',
      action: 'writeContent',
    });
    endRequestWindow(windowId);
    expect(text(latestReceiptParts(getActivitySnapshot()))).toBe(
      '✓ Created journal entry "Design review prep" · ✓ Wrote to "Design review prep"',
    );
  });

  it('clears the line after a layout-only request the user made', () => {
    recordChange('Added "A"', TASKS);
    const windowId = beginRequestWindow('ticket-1');
    endRequestWindow(windowId);
    expect(latestReceiptParts(getActivitySnapshot())).toEqual([]);
  });

  it('keeps the line through an automatic Engine turn that changed nothing', () => {
    recordChange('Added "A"', TASKS);
    endRequestWindow(beginRequestWindow());
    expect(text(latestReceiptParts(getActivitySnapshot()))).toBe('✓ Added "A"');
  });

  it('reuses the open window for repeated begins from the same or no owner', () => {
    const first = beginRequestWindow();
    expect(beginRequestWindow('ticket-1')).toBe(first);
    expect(beginRequestWindow()).toBe(first);
    expect(beginRequestWindow('ticket-1')).toBe(first);
  });

  it('starts a new window when a different owner begins', () => {
    const first = beginRequestWindow('ticket-1');
    recordChange('Added "A"', TASKS);
    const second = beginRequestWindow('ticket-2');
    expect(second).not.toBe(first);
    recordChange('Added "B"', TASKS);
    endRequestWindow(second);
    expect(text(latestReceiptParts(getActivitySnapshot()))).toBe('✓ Added "B"');
  });

  it('ignores an end for a window that is no longer open', () => {
    const first = beginRequestWindow('ticket-1');
    const second = beginRequestWindow('ticket-2');
    endRequestWindow(first);
    recordChange('Added "B"', TASKS);
    endRequestWindow(second);
    expect(text(latestReceiptParts(getActivitySnapshot()))).toBe('✓ Added "B"');
  });

  it('closes only an unowned window when no id is given', () => {
    const owned = beginRequestWindow('ticket-1');
    endRequestWindow();
    recordChange('Added "A"', TASKS);
    expect(getActivitySnapshot().entries[0].windowId).toBe(owned);
    endRequestWindow(owned);

    beginRequestWindow();
    endRequestWindow();
    expect(getActivitySnapshot().openWindowId).toBeNull();
  });

  it('keeps a direct action out of the request window that is open at the time', () => {
    const request = beginRequestWindow('ticket-1');
    markDirectAction({ vesselId: 'tasks', action: 'checkSubtask' });
    recordChange('Checked subtask "Check prototype"', {
      vesselId: 'tasks',
      action: 'checkSubtask',
    });
    expect(text(latestReceiptParts(getActivitySnapshot()))).toBe(
      '✓ Checked subtask "Check prototype"',
    );

    recordChange('Added "A"', TASKS);
    endRequestWindow(request);
    expect(text(latestReceiptParts(getActivitySnapshot()))).toBe('✓ Added "A"');
  });

  it('uses a direct mark once and lets it expire', () => {
    vi.useFakeTimers();
    try {
      beginRequestWindow('ticket-1');
      markDirectAction({ vesselId: 'tasks', action: 'checkTask' });
      vi.advanceTimersByTime(10_000);
      recordChange('Checked task "Ship this sprint"', {
        vesselId: 'tasks',
        action: 'checkTask',
      });
      const { entries, openWindowId } = getActivitySnapshot();
      expect(entries[0].windowId).toBe(openWindowId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies an execution plan attached after the window closed', () => {
    const windowId = beginRequestWindow('ticket-1');
    endRequestWindow(windowId);
    attachExecutionPlan(windowId, [plan('addTask')]);
    expect(text(latestReceiptParts(getActivitySnapshot()))).toBe(
      '? Not confirmed: addTask',
    );
  });

  it('tones confirmed parts as success and the rest as problems', () => {
    const windowId = beginRequestWindow();
    recordChange('Added "A"', TASKS);
    recordFailure('Couldn\'t find task "gym"', {
      vesselId: 'tasks',
      action: 'checkTask',
    });
    recordUnchanged('"B" was already done', {
      vesselId: 'tasks',
      action: 'checkTask',
    });
    endRequestWindow(windowId);
    expect(
      latestReceiptParts(getActivitySnapshot()).map((part) => part.tone),
    ).toEqual(['success', 'problem', 'success']);
  });

  it('summarises only the problems of a request for the intent feedback', () => {
    const windowId = beginRequestWindow('ticket-1');
    recordChange('Added "A"', TASKS);
    recordFailure('Couldn\'t find task "gym"', {
      vesselId: 'tasks',
      action: 'checkTask',
    });
    endRequestWindow(windowId);
    attachExecutionPlan(windowId, [
      plan('addTask'),
      plan('checkTask'),
      plan('removeTask'),
    ]);
    expect(problemSummaryForWindow(getActivitySnapshot(), windowId)).toBe(
      '✗ Couldn\'t find task "gym" · ? Not confirmed: removeTask',
    );
  });

  it('has no problem summary for a clean request', () => {
    const windowId = beginRequestWindow('ticket-1');
    recordChange('Added "A"', TASKS);
    endRequestWindow(windowId);
    attachExecutionPlan(windowId, [plan('addTask')]);
    expect(problemSummaryForWindow(getActivitySnapshot(), windowId)).toBeNull();
  });
});

function entry(
  outcome: ActivityEntry['outcome'],
  entryText: string,
  action = 'addTask',
): ActivityEntry {
  return {
    sequence: 0,
    windowId: 0,
    outcome,
    text: entryText,
    vesselId: 'tasks',
    action,
  };
}

function plan(action: string): ActionExecution {
  return {
    instanceId: 'tasks-1',
    action,
  } as unknown as ActionExecution;
}

function text(parts: readonly { text: string }[]): string {
  return parts.map((part) => part.text).join(' · ');
}
