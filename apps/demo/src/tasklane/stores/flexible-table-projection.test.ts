import { beforeEach, describe, expect, it } from 'vitest';

import type { TableColumn } from './flexible-table-columns';
import {
  groupProjectedRows,
  projectTableRows,
} from './flexible-table-projection';
import {
  __resetFlexibleTableStoreForTests,
  type FlexibleTableState,
  getFlexibleTableSnapshot,
} from './flexible-table.store';
import {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
  type ProjectTask,
} from './project-tasks.store';

beforeEach(() => {
  __resetProjectTasksStoreForTests();
  __resetFlexibleTableStoreForTests();
});

describe('flexible-table row projection', () => {
  it('supports dynamic task fields like dueDate when present on task records', () => {
    const taskWithDate = {
      ...getProjectTasksSnapshot().tasks[0]!,
      dueDate: '2026-12-01',
    } as ProjectTask & { dueDate: string };

    // When a task carries extra fields, a field column reads them
    // dynamically via projectTableRows.
    const state = withColumns([
      ...getFlexibleTableSnapshot().columns,
      {
        id: 'due_date',
        label: 'Due Date',
        kind: 'field' as const,
        field: 'dueDate',
      },
    ]);
    const rows = projectTableRows([taskWithDate], state);
    expect(rows[0]?.cells.due_date?.display).toBe('2026-12-01');
  });

  it('projects a cyclic table state as cell errors without crashing', () => {
    const cyclic = withColumns([
      {
        id: 'alpha',
        label: 'Alpha',
        kind: 'computed' as const,
        formula: 'spent + 1',
      },
      {
        id: 'spent',
        label: 'Spent',
        kind: 'computed' as const,
        formula: 'alpha + 1',
      },
    ]);

    const rows = projectTableRows(getProjectTasksSnapshot().tasks, cyclic);
    const tl1 = rows.find((r) => r.task.id === 'TL-1');
    expect(tl1?.cells.alpha?.error).toBeDefined();
    expect(tl1?.cells.spent?.error).toBeDefined();
  });
});

describe('flexible-table row grouping', () => {
  it('keeps blank cells and a literal (empty) value in separate groups', () => {
    const state: FlexibleTableState = {
      ...withColumns([
        ...getFlexibleTableSnapshot().columns,
        { id: 'notes', label: 'Notes', kind: 'free' },
      ]),
      cells: { notes: { 'TL-2': '(empty)' } },
      groupBy: 'notes',
    };

    const groups = groupProjectedRows(
      projectTableRows(getProjectTasksSnapshot().tasks, state),
      state,
    );
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.task.id)])).toEqual([
      ['(empty)', ['TL-1']],
      ['(empty)', ['TL-2']],
    ]);
  });

  it('groups numeric cells by value even when their labels round alike', () => {
    const state: FlexibleTableState = {
      ...withColumns([
        ...getFlexibleTableSnapshot().columns,
        {
          id: 'scaled',
          label: 'Scaled',
          kind: 'computed',
          formula: 'estimate / 1000',
        },
      ]),
      groupBy: 'scaled',
    };

    const groups = groupProjectedRows(
      projectTableRows(getProjectTasksSnapshot().tasks, state),
      state,
    );
    expect(groups.map((group) => group.label)).toEqual(['0.002', '0.004']);
    expect(groups.map((group) => group.rows.map((r) => r.task.id))).toEqual([
      ['TL-1'],
      ['TL-2'],
    ]);
  });
});

function withColumns(columns: readonly TableColumn[]): FlexibleTableState {
  return { ...getFlexibleTableSnapshot(), columns };
}
