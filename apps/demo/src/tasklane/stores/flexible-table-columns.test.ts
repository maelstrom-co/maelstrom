import { describe, expect, it } from 'vitest';

import {
  findColumn,
  lookupColumn,
  resolveTaskField,
  slugify,
  type TableColumn,
  uniqueColumnId,
} from './flexible-table-columns';
import { DEFAULT_TABLE_COLUMNS } from './flexible-table-presets';
import { getProjectTasksSnapshot } from './project-tasks.store';

describe('flexible-table task field resolution', () => {
  it('resolves date fields by name before any task exists', () => {
    expect(resolveTaskField('dueDate', [])).toBe('dueDate');
    expect(resolveTaskField('createdAt', [])).toBe('createdAt');
  });

  it('does not resolve inherited object properties as task fields', () => {
    const tasks = getProjectTasksSnapshot().tasks;
    for (const source of ['constructor', 'toString', '__proto__']) {
      expect(resolveTaskField(source, tasks)).toBeUndefined();
    }
    expect(lookupColumn('constructor', DEFAULT_TABLE_COLUMNS)).toEqual({
      kind: 'not_found',
    });

    expect(resolveTaskField('owner', tasks)).toBe('assigneeId');
    expect(resolveTaskField('estimate', tasks)).toBe('estimate');
  });
});

describe('flexible-table column lookup', () => {
  it('rejects a single-word label shared by two columns but keeps the exact id', () => {
    const first = uniqueColumnId(slugify('Notes'), DEFAULT_TABLE_COLUMNS);
    const withFirst = [...DEFAULT_TABLE_COLUMNS, freeColumn(first, 'Notes')];
    const second = uniqueColumnId(slugify('Notes'), withFirst);
    expect([first, second]).toEqual(['notes', 'notes_2']);
    const columns = [...withFirst, freeColumn(second, 'Notes')];

    expect(findColumn('Notes', columns)).toMatchObject({
      ok: false,
      reason: 'ambiguous_column',
      candidates: ['notes (Notes)', 'notes_2 (Notes)'],
    });
    expect(findColumn('notes', columns)).toMatchObject({
      ok: true,
      column: { id: 'notes' },
    });
  });

  it('does not match unrelated non-ASCII column names through the fallback id', () => {
    const id = uniqueColumnId(slugify('予算'), DEFAULT_TABLE_COLUMNS);
    expect(id).toBe('col');
    const columns = [...DEFAULT_TABLE_COLUMNS, freeColumn(id, '予算')];

    expect(findColumn('担当', columns)).toMatchObject({
      ok: false,
      reason: 'unknown_column',
    });
    expect(findColumn('col', columns)).toMatchObject({
      ok: true,
      column: { label: '予算' },
    });
    expect(findColumn('予算', columns)).toMatchObject({
      ok: true,
      column: { id: 'col' },
    });
  });
});

function freeColumn(id: string, label: string): TableColumn {
  return { id, label, kind: 'free' };
}
