import { describe, expect, it } from 'vitest';

import type { TableColumn } from './flexible-table-columns';
import { DEFAULT_TABLE_COLUMNS } from './flexible-table-presets';
import type { ProjectedTableRow } from './flexible-table-projection';
import {
  compareCells,
  type FilterRule,
  hasSortableValue,
  matchesFilter,
  rangeFilterValueMismatch,
} from './flexible-table-values';
import {
  getProjectTasksSnapshot,
  type ProjectTask,
  TASK_STATUS_NAMES,
} from './project-tasks.store';

describe('flexible-table filter matching', () => {
  it('compares status range filters by workflow order', () => {
    const rows = [
      taskRow({ id: 'TL-1', status: 'todo' }),
      taskRow({ id: 'TL-2', status: 'doing' }),
      taskRow({ id: 'TL-3', status: 'done' }),
    ];

    expect(rangeFilterValueMismatch(column('status'), 'doing')).toBeUndefined();
    expect(
      matchingIds(rows, { column: 'status', op: 'gt', value: 'doing' }),
    ).toEqual(['TL-3']);
    expect(
      rangeFilterValueMismatch(column('status'), 'In progress'),
    ).toBeUndefined();
    expect(
      matchingIds(rows, { column: 'status', op: 'lt', value: 'In progress' }),
    ).toEqual(['TL-1']);

    expect(rangeFilterValueMismatch(column('status'), 'blocked')).toBe(
      'status',
    );
  });

  it('compares urgency range filters by urgency rank', () => {
    const rows = [
      taskRow({ id: 'TL-1', urgency: 'low' }),
      taskRow({ id: 'TL-2', urgency: 'normal' }),
      taskRow({ id: 'TL-3', urgency: 'high' }),
    ];

    expect(
      rangeFilterValueMismatch(column('urgency'), 'normal'),
    ).toBeUndefined();
    expect(
      matchingIds(rows, { column: 'urgency', op: 'gt', value: 'normal' }),
    ).toEqual(['TL-3']);
    expect(
      rangeFilterValueMismatch(column('urgency'), 'Normal'),
    ).toBeUndefined();
    expect(
      matchingIds(rows, { column: 'urgency', op: 'lt', value: 'Normal' }),
    ).toEqual(['TL-1']);

    expect(rangeFilterValueMismatch(column('urgency'), 'urgent')).toBe(
      'urgency',
    );
  });

  it('compares task titles as text in equality filters', () => {
    const rows = [
      taskRow({ id: 'TL-1', title: 'Update demo README', estimate: 2 }),
      taskRow({ id: 'TL-2', title: 'Second task', estimate: 4 }),
      taskRow({ id: 'TL-3', title: '001', estimate: 0 }),
      taskRow({ id: 'TL-4', title: '1', estimate: 0 }),
    ];

    expect(
      matchingIds(rows, { column: 'title', op: 'eq', value: '001' }),
    ).toEqual(['TL-3']);
    expect(
      matchingIds(rows, { column: 'title', op: 'neq', value: '001' }),
    ).toEqual(['TL-1', 'TL-2', 'TL-4']);
    expect(
      matchingIds(rows, { column: 'estimate', op: 'eq', value: '2.0' }),
    ).toEqual(['TL-1']);
  });

  it('leaves out rows whose numeric cell is not a finite number from range filters', () => {
    const rows = [
      taskRow({ id: 'TL-1', estimate: 2 }),
      taskRow({ id: 'TL-2', estimate: 4 }),
      taskRow({ id: 'TL-3', estimate: Number.NaN }),
    ];

    expect(
      matchingIds(rows, { column: 'estimate', op: 'gt', value: '0' }),
    ).toEqual(['TL-1', 'TL-2']);
  });
});

describe('flexible-table cell ordering', () => {
  it('sorts mixed numeric and text values in one consistent order', () => {
    const notes: TableColumn = { id: 'notes', label: 'Notes', kind: 'free' };
    const ordered = ['2', '0x10', '1 item'].map(textCell);

    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        expect(compareCells(ordered[i]!, ordered[j]!, notes)).toBeLessThan(0);
        expect(compareCells(ordered[j]!, ordered[i]!, notes)).toBeGreaterThan(
          0,
        );
      }
    }
    expect(hasSortableValue(textCell(''))).toBe(false);
  });

  it('keeps whitespace-only cells with the blank cells when sorting', () => {
    const notes: TableColumn = { id: 'notes', label: 'Notes', kind: 'free' };

    expect(hasSortableValue(textCell('   '))).toBe(false);
    expect(hasSortableValue(textCell(''))).toBe(false);
    expect(hasSortableValue(textCell('0'))).toBe(true);
    expect(compareCells(textCell('0'), textCell('2'), notes)).toBeLessThan(0);
  });
});

function column(id: string): TableColumn {
  const found = DEFAULT_TABLE_COLUMNS.find((col) => col.id === id);
  if (!found) throw new Error(`No default column ${id}`);
  return found;
}

function matchingIds(
  rows: readonly ProjectedTableRow[],
  rule: FilterRule,
): readonly string[] {
  return rows
    .filter((row) => matchesFilter(row, rule, DEFAULT_TABLE_COLUMNS))
    .map((row) => row.task.id);
}

function taskRow(overrides: Partial<ProjectTask>): ProjectedTableRow {
  const task: ProjectTask = {
    ...getProjectTasksSnapshot().tasks[0]!,
    ...overrides,
  };
  return {
    task,
    cells: {
      title: textCell(task.title),
      status: { raw: task.status, display: TASK_STATUS_NAMES[task.status] },
      urgency: textCell(task.urgency),
      estimate: { raw: task.estimate, display: String(task.estimate) },
    },
  };
}

function textCell(value: string) {
  return { raw: value, display: value };
}
