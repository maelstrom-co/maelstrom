import { ActionName, InstanceId } from '@maelstrom-co/protocol';
import type { RequestActionOutcome, RequestOutcome } from '@maelstrom-co/react';
import { describe, expect, it } from 'vitest';

import {
  type ChangeDescription,
  describeChange,
  summariseReceipt,
} from './tasklane-activity';

describe('change notes', () => {
  it('uses singular phrasing for one change of each kind', () => {
    const changes: ChangeDescription[] = [
      { kind: 'created', subject: 'A' },
      { kind: 'described', subject: 'A' },
      { kind: 'moved', subject: 'B', detail: null },
      { kind: 'moved', subject: 'B', detail: 'Parent' },
      { kind: 'deprioritised', subject: 'C' },
      { kind: 'reprioritised', subject: 'D', detail: '2' },
      { kind: 'removed', subject: 'E' },
      { kind: 'unassigned', subject: 'F' },
      { kind: 'renamed', subject: 'G' },
      { kind: 'edited', subject: 'H' },
      { kind: 'reassigned', subject: 'I', detail: 'Alex' },
      { kind: 'urgency', subject: 'J', detail: 'high' },
      { kind: 'status', subject: 'K', detail: 'doing' },
      { kind: 'status', subject: 'L', detail: 'blocked' },
      { kind: 'dueDate', subject: 'M', detail: '2026-05-01' },
      { kind: 'dueDate', subject: 'M', detail: null },
      { kind: 'feedback', subject: 'feedback', detail: 'truncated' },
      { kind: 'feedback', subject: 'feedback', detail: null },
    ];
    expect(changes.map(describeChange)).toEqual([
      'Created "A"',
      'Updated the description of "A"',
      'Moved "B" to the top level',
      'Moved "B" under "Parent"',
      'Removed "C" from your priorities',
      'Moved "D" to priority #2',
      'Deleted "E"',
      'Unassigned "F"',
      'Renamed "G"',
      'Updated "H"',
      'Reassigned "I" to Alex',
      'Set "J" to high urgency',
      'Marked "K" as in progress',
      'Marked "L" as blocked',
      'Set "M" due 2026-05-01',
      'Cleared the due date on "M"',
      'Replaced the feedback (truncated to 2000 characters)',
      'Replaced the feedback',
    ]);
  });
});

describe('request receipts', () => {
  it('shows nothing before a request', () => {
    expect(summariseReceipt(undefined)).toBeNull();
  });

  it('aggregates same-kind changes in one request', () => {
    const actions = ['A', 'B', 'C', 'D'].map((title) =>
      ran('createTask', { title }, `Created "${title}"`),
    );
    expect(summariseReceipt(outcome(actions))).toEqual({
      text: '✓ Created 4 tasks',
      tone: 'success',
    });
  });

  it('describes grouping, assignment and priorities like a person would', () => {
    expect(
      summariseReceipt(
        outcome([
          ran(
            'createTask',
            { title: 'Improve the demo' },
            'Created "Improve the demo"',
          ),
          ...['A', 'B', 'C', 'D'].map((title, i) =>
            ran(
              'setParent',
              { task: `TL-${i + 1} ${title}`, parent: 'Improve the demo' },
              `Moved "${title}" under "Improve the demo"`,
            ),
          ),
        ]),
      )?.text,
    ).toBe(
      '✓ Created "Improve the demo" · ✓ Grouped 4 tasks under "Improve the demo"',
    );

    expect(
      summariseReceipt(
        outcome([
          ...['A', 'B', 'C', 'D'].map((title, i) =>
            ran(
              'assignTask',
              { task: `TL-${i + 1}`, assignee: 'chris' },
              `Assigned "${title}" to Chris`,
            ),
          ),
          ...['A', 'B', 'C', 'D'].map((title, i) =>
            ran(
              'addToMyPriorities',
              { task: `TL-${i + 1}` },
              `Added "${title}" to your priorities`,
            ),
          ),
        ]),
      )?.text,
    ).toBe('✓ Assigned 4 tasks to Chris · ✓ Added 4 tasks to your priorities');
  });

  it('groups status changes by the status they reached', () => {
    expect(
      summariseReceipt(
        outcome([
          ...['TL-1', 'TL-2', 'TL-3'].map((task) =>
            ran(
              'setStatus',
              { task, status: 'done' },
              `Marked "${task}" as done`,
            ),
          ),
          ran(
            'setStatus',
            { task: 'TL-4', status: 'doing' },
            'Marked "Write demo copy" as in progress',
          ),
        ]),
      ),
    ).toEqual({
      text: '✓ Marked 3 tasks as done · ✓ Marked "Write demo copy" as in progress',
      tone: 'success',
    });
  });

  it('groups due date changes by the date they set, and cleared dates together', () => {
    expect(
      summariseReceipt(
        outcome([
          ran(
            'setDueDate',
            { task: 'TL-1 A', dueDate: '2026-05-01' },
            'Set "A" due 2026-05-01',
          ),
          ran(
            'setDueDate',
            { task: 'TL-2 B', dueDate: '2026-05-01' },
            'Set "B" due 2026-05-01',
          ),
          ran(
            'setDueDate',
            { task: 'TL-3 C', dueDate: '2026-06-01' },
            'Set "C" due 2026-06-01',
          ),
          ran(
            'setDueDate',
            { task: 'TL-4 D', dueDate: 'none' },
            'Cleared the due date on "D"',
          ),
          ran(
            'setDueDate',
            { task: 'TL-5 E', dueDate: 'none' },
            'Cleared the due date on "E"',
          ),
        ]),
      )?.text,
    ).toBe(
      '✓ Set 2 tasks due 2026-05-01 · ✓ Set "C" due 2026-06-01 · ✓ Cleared due dates on 2 tasks',
    );
  });

  it('shows a skipped or unknown due date change as not confirmed', () => {
    expect(
      summariseReceipt(
        outcome([
          {
            instanceId: TASKS,
            action: ActionName('setDueDate'),
            status: 'unknown',
          },
        ]),
      ),
    ).toEqual({ text: '? Not confirmed: set a due date', tone: 'problem' });
  });

  it('pluralises descriptions', () => {
    expect(
      summariseReceipt(
        outcome([
          ran('updateTask', { task: 'TL-1' }, 'Updated the description of "A"'),
          ran('updateTask', { task: 'TL-2' }, 'Updated the description of "B"'),
        ]),
      )?.text,
    ).toBe('✓ Updated 2 descriptions');
  });

  it('counts a task changed twice the same way as one task', () => {
    const receipt = 'Set "Write demo copy" to high urgency';
    expect(
      summariseReceipt(
        outcome([
          ran('setUrgency', { task: 'TL-1 Write demo copy (Alex)' }, receipt),
          ran('setUrgency', { task: 'tl-1' }, receipt),
        ]),
      )?.text,
    ).toBe(`✓ ${receipt}`);
  });

  it('counts different tasks that share a title separately', () => {
    const receipt = 'Set "Write demo copy" to high urgency';
    expect(
      summariseReceipt(
        outcome([
          ran('setUrgency', { task: 'TL-1' }, receipt),
          ran('setUrgency', { task: 'TL-2' }, receipt),
        ]),
      )?.text,
    ).toBe('✓ Set 2 tasks to high urgency');
  });

  it('puts failures first and never reports them as success', () => {
    expect(
      summariseReceipt(
        outcome(
          [
            ran(
              'updateTask',
              { task: 'TL-1' },
              'Updated the description of "A"',
            ),
            failed(
              'updateTask',
              'Couldn\'t update "Write demo copy" because it changed: now assigned to Alex\nTL-3 changed. Use its current label.',
            ),
            ran(
              'updateTask',
              { task: 'TL-2' },
              'Updated the description of "B"',
            ),
          ],
          'unknown',
        ),
      ),
    ).toEqual({
      text: '✗ Couldn\'t update "Write demo copy" because it changed: now assigned to Alex · ✓ Updated 2 descriptions',
      tone: 'problem',
    });
  });

  it('shows planned data Actions that were skipped or whose outcome is unknown as not confirmed', () => {
    expect(
      summariseReceipt(
        outcome(
          [
            ran('assignTask', { task: 'TL-1' }, 'Assigned "A" to Chris'),
            skipped('assignTask'),
            unknown('assignTask'),
            unknown('addToMyPriorities'),
          ],
          'unknown',
        ),
      ),
    ).toEqual({
      text: '? Not confirmed: assign a task, add to your priorities · ✓ Assigned "A" to Chris',
      tone: 'problem',
    });
  });

  it('reports a failed Action without a reason for the person by its phrase', () => {
    expect(
      summariseReceipt(
        outcome(
          [
            failed('assignTask', 'Handler timed out'),
            failed('showSomething', 'boom'),
          ],
          'unknown',
        ),
      ),
    ).toEqual({ text: "✗ Couldn't assign a task", tone: 'problem' });
  });

  it('does not merge an Action failure with another of the same Action', () => {
    expect(
      summariseReceipt(
        outcome(
          [
            failed('updateTask', 'Couldn\'t update "A" because it changed'),
            failed('updateTask', 'Handler threw'),
          ],
          'unknown',
        ),
      ),
    ).toEqual({
      text: '✗ Couldn\'t update "A" because it changed · ✗ Couldn\'t update a task',
      tone: 'problem',
    });
  });

  it('counts an Action that ran without a value as confirmed without a receipt part', () => {
    expect(
      summariseReceipt(outcome([ran('addToMyPriorities', { task: 'TL-1' })])),
    ).toBeNull();
  });

  it('shows no receipt part for a value that is not text', () => {
    expect(
      summariseReceipt(
        outcome([ran('setUrgency', { task: 'TL-1' }, { urgency: 'high' })]),
      ),
    ).toBeNull();
  });

  it('shows no line for a layout-only request', () => {
    expect(summariseReceipt(outcome([]))).toBeNull();
  });

  it('ignores skipped Actions outside the Tasklane data Actions', () => {
    expect(summariseReceipt(outcome([skipped('showSomething')]))).toBeNull();
  });

  it('shows settled Actions while the rest are still pending', () => {
    expect(
      summariseReceipt(
        outcome(
          [
            ran('createTask', { title: 'A' }, 'Created "A"'),
            pending('createTask'),
          ],
          'processing',
        ),
      )?.text,
    ).toBe('✓ Created "A"');
  });

  it('reports a request that failed before any Action ran', () => {
    expect(summariseReceipt(outcome([], 'failed'))).toEqual({
      text: "✗ Couldn't complete the request",
      tone: 'problem',
    });
  });

  it('never reports an unknown request outcome as failed', () => {
    expect(summariseReceipt(outcome([], 'unknown'))).toEqual({
      text: '? Not confirmed: the request',
      tone: 'problem',
    });
  });
});

const TASKS = InstanceId('project-tasks-main');

function outcome(
  actions: RequestActionOutcome[],
  status: RequestOutcome['status'] = 'applied',
): RequestOutcome {
  return {
    id: 'ticket-1',
    intent: 'test',
    status,
    actions,
    ...(status === 'failed' || status === 'unknown'
      ? { error: new Error('request error') }
      : {}),
  };
}

function ran(
  action: string,
  params: Record<string, unknown>,
  value?: unknown,
): RequestActionOutcome {
  return {
    instanceId: TASKS,
    action: ActionName(action),
    params,
    status: 'ran',
    ...(value === undefined ? {} : { value }),
  };
}

function failed(action: string, reason: string): RequestActionOutcome {
  return {
    instanceId: TASKS,
    action: ActionName(action),
    status: 'failed',
    reason,
  };
}

function skipped(action: string): RequestActionOutcome {
  return {
    instanceId: TASKS,
    action: ActionName(action),
    status: 'skipped',
    reason: 'instance_missing',
  };
}

function unknown(action: string): RequestActionOutcome {
  return { instanceId: TASKS, action: ActionName(action), status: 'unknown' };
}

function pending(action: string): RequestActionOutcome {
  return { instanceId: TASKS, action: ActionName(action), status: 'pending' };
}
