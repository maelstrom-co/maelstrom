import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetTasklaneActivityForTests,
  closeRequestWindow,
  failRequestWindow,
  getLatestReceipt,
  openRequestWindow,
  recordChange,
  recordFailure,
  recordUnchanged,
  settleRequestActions,
} from './tasklane-activity';

beforeEach(() => {
  __resetTasklaneActivityForTests();
});

describe('direct interactions', () => {
  it('turns a change outside any request into its own one-entry receipt', () => {
    recordChange('assignTask', {
      kind: 'reassigned',
      subject: 'Write demo copy',
      subjectId: 'Write demo copy',
      detail: 'Alex',
    });
    expect(getLatestReceipt()).toEqual({
      text: '✓ Reassigned "Write demo copy" to Alex',
      tone: 'success',
    });

    recordChange('setUrgency', {
      kind: 'urgency',
      subject: 'Write demo copy',
      subjectId: 'Write demo copy',
      detail: 'high',
    });
    expect(getLatestReceipt()?.text).toBe(
      '✓ Set "Write demo copy" to high urgency',
    );
  });

  it('shows a direct failure as a problem', () => {
    recordFailure('removeTask', 'Couldn\'t find a task matching "Ghost"');
    expect(getLatestReceipt()).toEqual({
      text: '✗ Couldn\'t find a task matching "Ghost"',
      tone: 'problem',
    });
  });

  it('shows nothing for an unchanged direct edit', () => {
    recordUnchanged('setUrgency');
    expect(getLatestReceipt()).toBeNull();
  });
});

describe('request windows', () => {
  it('aggregates same-kind changes in one request', () => {
    openRequestWindow('r1');
    for (const subject of ['A', 'B', 'C', 'D']) {
      recordChange('createTask', {
        kind: 'created',
        subject,
        subjectId: subject,
      });
    }
    settleRequestActions('r1', []);
    closeRequestWindow();
    expect(getLatestReceipt()).toEqual({
      text: '✓ Created 4 tasks',
      tone: 'success',
    });
  });

  it('describes grouping, assignment and priorities like a person would', () => {
    openRequestWindow('r1');
    recordChange('createTask', {
      kind: 'created',
      subject: 'Improve the demo',
      subjectId: 'Improve the demo',
    });
    for (const subject of ['A', 'B', 'C', 'D']) {
      recordChange('setParent', {
        kind: 'moved',
        subject,
        subjectId: subject,
        detail: 'Improve the demo',
      });
    }
    closeRequestWindow();
    expect(getLatestReceipt()?.text).toBe(
      '✓ Created "Improve the demo" · ✓ Grouped 4 tasks under "Improve the demo"',
    );

    openRequestWindow('r2');
    for (const subject of ['A', 'B', 'C', 'D']) {
      recordChange('assignTask', {
        kind: 'assigned',
        subject,
        subjectId: subject,
        detail: 'Chris',
      });
    }
    for (const subject of ['A', 'B', 'C', 'D']) {
      recordChange('addToMyPriorities', {
        kind: 'prioritised',
        subject,
        subjectId: subject,
      });
    }
    closeRequestWindow();
    expect(getLatestReceipt()?.text).toBe(
      '✓ Assigned 4 tasks to Chris · ✓ Added 4 tasks to your priorities',
    );
  });

  it('uses singular phrasing for one change of each kind', () => {
    openRequestWindow('r1');
    recordChange('updateTask', {
      kind: 'described',
      subject: 'A',
      subjectId: 'A',
    });
    recordChange('setParent', {
      kind: 'moved',
      subject: 'B',
      subjectId: 'B',
      detail: null,
    });
    recordChange('removeFromMyPriorities', {
      kind: 'deprioritised',
      subject: 'C',
      subjectId: 'C',
    });
    recordChange('addToMyPriorities', {
      kind: 'reprioritised',
      subject: 'D',
      subjectId: 'D',
      detail: '2',
    });
    recordChange('removeTask', {
      kind: 'removed',
      subject: 'E',
      subjectId: 'E',
    });
    recordChange('assignTask', {
      kind: 'unassigned',
      subject: 'F',
      subjectId: 'F',
    });
    recordChange('updateTask', {
      kind: 'renamed',
      subject: 'G',
      subjectId: 'G',
    });
    recordChange('replaceFeedback', {
      kind: 'feedback',
      subject: 'feedback',
      subjectId: 'feedback',
      detail: 'truncated',
    });
    closeRequestWindow();
    expect(getLatestReceipt()?.text).toBe(
      [
        '✓ Updated the description of "A"',
        '✓ Moved "B" to the top level',
        '✓ Removed "C" from your priorities',
        '✓ Moved "D" to priority #2',
        '✓ Deleted "E"',
        '✓ Unassigned "F"',
        '✓ Renamed "G"',
        '✓ Replaced the feedback (truncated to 2000 characters)',
      ].join(' · '),
    );
  });

  it('groups status changes by the status they reached', () => {
    openRequestWindow('r1');
    for (const subjectId of ['TL-1', 'TL-2', 'TL-3']) {
      recordChange('setStatus', {
        kind: 'status',
        subject: subjectId,
        subjectId,
        detail: 'done',
      });
    }
    recordChange('setStatus', {
      kind: 'status',
      subject: 'Write demo copy',
      subjectId: 'TL-4',
      detail: 'doing',
    });
    settleRequestActions('r1', []);
    closeRequestWindow();
    expect(getLatestReceipt()).toEqual({
      text: '✓ Marked 3 tasks as done · ✓ Marked "Write demo copy" as in progress',
      tone: 'success',
    });
  });

  it('names a status it does not know as it was recorded', () => {
    recordChange('setStatus', {
      kind: 'status',
      subject: 'Write demo copy',
      subjectId: 'TL-4',
      detail: 'blocked',
    });
    expect(getLatestReceipt()?.text).toBe(
      '✓ Marked "Write demo copy" as blocked',
    );
  });

  it('pluralises descriptions', () => {
    openRequestWindow('r1');
    recordChange('updateTask', {
      kind: 'described',
      subject: 'A',
      subjectId: 'A',
    });
    recordChange('updateTask', {
      kind: 'described',
      subject: 'B',
      subjectId: 'B',
    });
    closeRequestWindow();
    expect(getLatestReceipt()?.text).toBe('✓ Updated 2 descriptions');
  });

  it('counts a task changed twice the same way as one task', () => {
    openRequestWindow('r1');
    for (let step = 0; step < 2; step += 1) {
      recordChange('setUrgency', {
        kind: 'urgency',
        subject: 'Write demo copy',
        subjectId: 'TL-1',
        detail: 'high',
      });
    }
    closeRequestWindow();
    expect(getLatestReceipt()?.text).toBe(
      '✓ Set "Write demo copy" to high urgency',
    );
  });

  it('counts different tasks that share a title separately', () => {
    openRequestWindow('r1');
    for (const subjectId of ['TL-1', 'TL-2']) {
      recordChange('setUrgency', {
        kind: 'urgency',
        subject: 'Write demo copy',
        subjectId,
        detail: 'high',
      });
    }
    closeRequestWindow();
    expect(getLatestReceipt()?.text).toBe('✓ Set 2 tasks to high urgency');
  });

  it('puts failures first and never reports them as success', () => {
    openRequestWindow('r1');
    recordChange('updateTask', {
      kind: 'described',
      subject: 'A',
      subjectId: 'A',
    });
    recordChange('updateTask', {
      kind: 'described',
      subject: 'B',
      subjectId: 'B',
    });
    recordFailure(
      'updateTask',
      'Couldn\'t update "Write demo copy" because it changed: now assigned to Alex',
    );
    settleRequestActions('r1', []);
    closeRequestWindow();
    expect(getLatestReceipt()).toEqual({
      text: '✗ Couldn\'t update "Write demo copy" because it changed: now assigned to Alex · ✓ Updated 2 descriptions',
      tone: 'problem',
    });
  });

  it('shows planned data Actions the orchestrator skipped as not confirmed', () => {
    openRequestWindow('r1');
    recordChange('assignTask', {
      kind: 'assigned',
      subject: 'A',
      subjectId: 'A',
      detail: 'Chris',
    });
    expect(getLatestReceipt()?.text).toBe('✓ Assigned "A" to Chris');

    settleRequestActions('r1', [
      'assignTask',
      'assignTask',
      'addToMyPriorities',
    ]);
    closeRequestWindow();
    expect(getLatestReceipt()).toEqual({
      text: '? Not confirmed: assign a task, add to your priorities · ✓ Assigned "A" to Chris',
      tone: 'problem',
    });
  });

  it('does not let a manual edit during a request confirm a skipped planned Action', () => {
    openRequestWindow('r1');
    recordChange('assignTask', {
      kind: 'assigned',
      subject: 'Manual',
      subjectId: 'TL-1',
      detail: 'Sam',
    });
    settleRequestActions('r1', ['assignTask']);
    closeRequestWindow();
    expect(getLatestReceipt()).toEqual({
      text: '? Not confirmed: assign a task · ✓ Assigned "Manual" to Sam',
      tone: 'problem',
    });
  });

  it('counts an unchanged Action as confirmed without a receipt part', () => {
    openRequestWindow('r1');
    recordUnchanged('addToMyPriorities');
    settleRequestActions('r1', []);
    closeRequestWindow();
    expect(getLatestReceipt()).toBeNull();
  });

  it('shows no line for a layout-only request', () => {
    recordChange('createTask', {
      kind: 'created',
      subject: 'Earlier',
      subjectId: 'Earlier',
    });
    openRequestWindow('r1');
    settleRequestActions('r1', []);
    closeRequestWindow();
    expect(getLatestReceipt()).toBeNull();
  });

  it('ignores skipped Actions outside the Tasklane data Actions', () => {
    openRequestWindow('r1');
    settleRequestActions('r1', ['showSomething']);
    closeRequestWindow();
    expect(getLatestReceipt()).toBeNull();
  });

  it('reports a request that failed before any Action ran', () => {
    openRequestWindow('r1');
    failRequestWindow('r1', "Couldn't complete the request");
    closeRequestWindow();
    expect(getLatestReceipt()).toEqual({
      text: "✗ Couldn't complete the request",
      tone: 'problem',
    });
  });

  it('closes the previous window when the next request starts', () => {
    openRequestWindow('r1');
    recordChange('createTask', {
      kind: 'created',
      subject: 'A',
      subjectId: 'A',
    });
    openRequestWindow('r2');
    recordChange('createTask', {
      kind: 'created',
      subject: 'B',
      subjectId: 'B',
    });
    closeRequestWindow();
    expect(getLatestReceipt()?.text).toBe('✓ Created "B"');
  });
});
