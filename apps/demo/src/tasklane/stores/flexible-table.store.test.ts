import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetFlexibleTableStoreForTests,
  flexibleTableActions,
  getFlexibleTableSnapshot,
  groupProjectedRows,
  projectTableRows,
} from './flexible-table.store';
import {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
  type ProjectTask,
  projectTaskActions,
} from './project-tasks.store';

beforeEach(() => {
  __resetProjectTasksStoreForTests();
  __resetFlexibleTableStoreForTests();
});

describe('flexible-table store columns', () => {
  it('adds a computed column summing estimate and spent and projects values', () => {
    const added = flexibleTableActions.addColumn({
      label: 'Total',
      kind: 'computed',
      formula: 'estimate + spent',
    });
    expect(added).toMatchObject({
      ok: true,
      changed: true,
      value: { id: 'total', label: 'Total', kind: 'computed' },
    });

    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    expect(rows.map((r) => [r.task.id, r.cells.total?.raw])).toEqual([
      ['TL-1', 3],
      ['TL-2', 7],
    ]);
  });

  it('rejects bad formulas and unknown columns with typed errors', () => {
    expect(
      flexibleTableActions.addColumn({
        label: 'Broken',
        kind: 'computed',
        formula: 'estimate + *',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid_formula' });

    expect(
      flexibleTableActions.addColumn({
        label: 'Missing ref',
        kind: 'computed',
        formula: 'estimate + nope',
      }),
    ).toMatchObject({ ok: false, reason: 'unknown_column', query: 'nope' });

    expect(flexibleTableActions.sortBy('ghost', 'asc')).toMatchObject({
      ok: false,
      reason: 'unknown_column',
      query: 'ghost',
    });

    expect(flexibleTableActions.filterRows('ghost', 'eq', 'x')).toMatchObject({
      ok: false,
      reason: 'unknown_column',
      query: 'ghost',
    });
  });

  it('reports #ERR without crashing when a computed formula divides by zero on a row', () => {
    projectTaskActions.createTask({
      title: 'Zero spent task',
      estimate: 5,
      spent: 0,
    });
    const added = flexibleTableActions.addColumn({
      label: 'Ratio',
      kind: 'computed',
      formula: 'estimate / spent',
    });
    expect(added.ok).toBe(true);

    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    const zeroRow = rows.find((r) => r.task.id === 'TL-3');
    expect(zeroRow?.cells.ratio?.display).toBe('#ERR');
    expect(zeroRow?.cells.ratio?.error).toContain('Division by zero');
  });

  it('supports adding, renaming, moving, and removing columns', () => {
    const added = flexibleTableActions.addColumn({
      label: 'Notes',
      kind: 'free',
    });
    expect(added.ok).toBe(true);

    expect(
      flexibleTableActions.renameColumn('notes', 'Status Notes'),
    ).toMatchObject({
      ok: true,
      changed: true,
      value: { id: 'notes', label: 'Status Notes' },
    });

    expect(flexibleTableActions.moveColumn('Status Notes', 2)).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(getFlexibleTableSnapshot().columns[1]?.id).toBe('notes');

    expect(flexibleTableActions.removeColumn('notes')).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(
      getFlexibleTableSnapshot().columns.some((c) => c.id === 'notes'),
    ).toBe(false);
  });

  it('updates free column cells and refuses editing non-free columns', () => {
    projectTaskActions.createTask({ title: 'Ship table' });
    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });

    expect(flexibleTableActions.setCell('TL-3', 'notes', 'blocked')).toEqual({
      ok: true,
      changed: true,
    });

    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    expect(rows.find((r) => r.task.id === 'TL-3')?.cells.notes?.display).toBe(
      'blocked',
    );

    expect(flexibleTableActions.setCell('TL-3', 'title', 'nope')).toMatchObject(
      { ok: false, reason: 'not_free_column' },
    );
  });

  it('supports dynamic task fields like dueDate when present on task records', () => {
    const taskWithDate = {
      ...getProjectTasksSnapshot().tasks[0]!,
      dueDate: '2026-12-01',
    } as ProjectTask & { dueDate: string };

    // When a task carries extra fields (e.g. from the task dates ticket), a
    // field column reads them dynamically via projectTableRows.
    const state = {
      ...getFlexibleTableSnapshot(),
      columns: [
        ...getFlexibleTableSnapshot().columns,
        {
          id: 'due_date',
          label: 'Due Date',
          kind: 'field' as const,
          field: 'dueDate',
        },
      ],
    };
    const rows = projectTableRows([taskWithDate], state);
    expect(rows[0]?.cells.due_date?.display).toBe('2026-12-01');
  });
});

describe('flexible-table sorting and stability', () => {
  it('sorts by urgency descending, then assignee ascending, preserving stability on ties', () => {
    projectTaskActions.createTask({
      title: 'Alpha high',
      assignee: 'sam',
      urgency: 'high',
    }); // TL-3
    projectTaskActions.createTask({
      title: 'Beta high',
      assignee: 'alex',
      urgency: 'high',
    }); // TL-4
    projectTaskActions.createTask({
      title: 'Gamma high',
      assignee: 'alex',
      urgency: 'high',
    }); // TL-5
    projectTaskActions.createTask({
      title: 'Low task',
      assignee: 'chris',
      urgency: 'low',
    }); // TL-6

    expect(flexibleTableActions.sortBy('urgency', 'desc', false).ok).toBe(true);
    expect(flexibleTableActions.sortBy('assignee', 'asc', true).ok).toBe(true);

    const orderedIds = projectTableRows(getProjectTasksSnapshot().tasks).map(
      (r) => r.task.id,
    );
    // High urgency first: TL-4 and TL-5 (Alex, stable creation order), then TL-3 (Sam)
    // Normal urgency next: TL-1 (Alex), TL-2 (Sam)
    // Low urgency last: TL-6 (Chris)
    expect(orderedIds).toEqual([
      'TL-4',
      'TL-5',
      'TL-3',
      'TL-1',
      'TL-2',
      'TL-6',
    ]);
  });

  it('sorts by a newly added computed column in the same sequence', () => {
    flexibleTableActions.addColumn({
      label: 'Total',
      kind: 'computed',
      formula: 'estimate + spent',
    });
    expect(flexibleTableActions.sortBy('Total', 'desc').ok).toBe(true);

    const orderedIds = projectTableRows(getProjectTasksSnapshot().tasks).map(
      (r) => r.task.id,
    );
    expect(orderedIds).toEqual(['TL-2', 'TL-1']);
  });

  it('clears sort rules', () => {
    flexibleTableActions.sortBy('estimate', 'desc');
    expect(flexibleTableActions.clearSort()).toEqual({
      ok: true,
      changed: true,
    });
    expect(getFlexibleTableSnapshot().sort).toEqual([]);
  });
});

describe('flexible-table filtering, grouping, and triage preset', () => {
  it('supports eq, neq, contains, gt, and lt filter operators', () => {
    projectTaskActions.createTask({
      title: 'Fix auth bug',
      assignee: 'alex',
      estimate: 5,
      spent: 1,
    }); // TL-3
    projectTaskActions.setStatus('TL-3', 'doing');

    // "Show only Alex's doing tasks"
    expect(flexibleTableActions.filterRows('assignee', 'eq', 'alex').ok).toBe(
      true,
    );
    expect(flexibleTableActions.filterRows('status', 'eq', 'doing').ok).toBe(
      true,
    );
    expect(
      projectTableRows(getProjectTasksSnapshot().tasks).map((r) => r.task.id),
    ).toEqual(['TL-3']);

    // clearFilters
    flexibleTableActions.clearFilters();
    expect(projectTableRows(getProjectTasksSnapshot().tasks)).toHaveLength(3);

    // contains
    flexibleTableActions.filterRows('title', 'contains', 'auth');
    expect(
      projectTableRows(getProjectTasksSnapshot().tasks).map((r) => r.task.id),
    ).toEqual(['TL-3']);

    // gt & lt
    flexibleTableActions.clearFilters();
    flexibleTableActions.filterRows('estimate', 'gt', '2');
    flexibleTableActions.filterRows('estimate', 'lt', '5');
    expect(
      projectTableRows(getProjectTasksSnapshot().tasks).map((r) => r.task.id),
    ).toEqual(['TL-2']);

    // neq
    flexibleTableActions.clearFilters();
    flexibleTableActions.filterRows('assignee', 'neq', 'alex');
    expect(
      projectTableRows(getProjectTasksSnapshot().tasks).map((r) => r.task.id),
    ).toEqual(['TL-2']);
  });

  it('groups rows by a column and supports clearing groupBy', () => {
    projectTaskActions.createTask({
      title: 'Second Alex task',
      assignee: 'alex',
    });
    expect(flexibleTableActions.groupBy('assignee').ok).toBe(true);

    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    const groups = groupProjectedRows(rows);
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ['Alex', 2],
      ['Sam', 1],
    ]);

    expect(flexibleTableActions.groupBy('none')).toEqual({
      ok: true,
      changed: true,
      value: null,
    });
  });

  it('shows only tasks with no owner or no parent in the triage preset', () => {
    // Make TL-1 a parent of a child task assigned to Chris -> neither TL-1 nor child needs triage
    projectTaskActions.createTask({
      title: 'Child with owner',
      parent: 'TL-1',
      assignee: 'chris',
    }); // TL-3 (has parent + owner -> excluded)
    projectTaskActions.createTask({
      title: 'Child without owner',
      parent: 'TL-1',
      assignee: 'unassigned',
    }); // TL-4 (no owner -> included)
    projectTaskActions.setStatus('TL-2', 'done'); // done -> excluded

    expect(flexibleTableActions.showPreset('triage').ok).toBe(true);
    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    expect(rows.map((r) => [r.task.id, r.cells.reason?.display])).toEqual([
      ['TL-4', 'no owner'],
    ]);
  });
});
