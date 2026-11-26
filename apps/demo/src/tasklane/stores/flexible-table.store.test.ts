import { beforeEach, describe, expect, it } from 'vitest';

import { flexibleTableVessel } from '../vessels/flexible-table.vessel.def';
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

describe('flexible-table review regressions', () => {
  it('rejects an oversized formula as invalid_formula', () => {
    expect(
      flexibleTableActions.addColumn({
        label: 'Huge',
        kind: 'computed',
        formula: '1' + '+1'.repeat(20000),
      }),
    ).toMatchObject({ ok: false, reason: 'invalid_formula' });
  });

  it('does not declare removeColumn as idempotent and removes by id before label', () => {
    const removeColumn = flexibleTableVessel.variants.table.actions.find(
      (action) => action.name === 'removeColumn',
    );
    expect(removeColumn).toBeDefined();
    expect(removeColumn).not.toHaveProperty('effect', 'idempotent');

    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });
    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });
    expect(flexibleTableActions.removeColumn('notes')).toMatchObject({
      ok: true,
      value: { id: 'notes' },
    });
    const ids = getFlexibleTableSnapshot().columns.map((col) => col.id);
    expect(ids).toContain('notes_2');
    expect(ids).not.toContain('notes');
  });

  it('combines several filters on the same column with AND', () => {
    projectTaskActions.createTask({ title: 'In progress' }); // TL-3
    projectTaskActions.setStatus('TL-3', 'doing');
    projectTaskActions.setStatus('TL-2', 'done');

    expect(flexibleTableActions.filterRows('status', 'neq', 'todo').ok).toBe(
      true,
    );
    expect(flexibleTableActions.filterRows('status', 'neq', 'done').ok).toBe(
      true,
    );
    expect(getFlexibleTableSnapshot().filters).toHaveLength(2);
    expect(
      projectTableRows(getProjectTasksSnapshot().tasks).map((r) => r.task.id),
    ).toEqual(['TL-3']);

    expect(
      flexibleTableActions.filterRows('status', 'neq', 'done'),
    ).toMatchObject({ ok: true, changed: false });
    expect(getFlexibleTableSnapshot().filters).toHaveLength(2);
  });

  it('gives columns labelled with an ungroup word a groupable id', () => {
    const added = flexibleTableActions.addColumn({
      label: 'Clear',
      kind: 'free',
    });
    expect(added).toMatchObject({ ok: true, value: { id: 'clear_2' } });
    expect(flexibleTableActions.groupBy('clear_2')).toMatchObject({
      ok: true,
      value: 'clear_2',
    });
    expect(getFlexibleTableSnapshot().groupBy).toBe('clear_2');
    expect(flexibleTableActions.groupBy('clear')).toMatchObject({
      ok: true,
      value: null,
    });
  });

  it('clears free cell data when a preset replaces the columns', () => {
    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });
    flexibleTableActions.setCell('TL-1', 'notes', 'hello');
    flexibleTableActions.showPreset('default');
    expect(getFlexibleTableSnapshot().cells).toEqual({});

    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });
    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    expect(rows.find((r) => r.task.id === 'TL-1')?.cells.notes?.display).toBe(
      '',
    );

    flexibleTableActions.setCell('TL-1', 'notes', 'again');
    flexibleTableActions.showPreset('triage');
    expect(getFlexibleTableSnapshot().cells).toEqual({});
  });

  it('keeps blank cells and a literal (empty) value in separate groups', () => {
    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });
    flexibleTableActions.setCell('TL-2', 'notes', '(empty)');
    flexibleTableActions.groupBy('notes');

    const groups = groupProjectedRows(
      projectTableRows(getProjectTasksSnapshot().tasks),
    );
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.task.id)])).toEqual([
      ['(empty)', ['TL-1']],
      ['(empty)', ['TL-2']],
    ]);
  });

  it('lets a computed column reference the task field that shares its name', () => {
    flexibleTableActions.showPreset('triage');
    flexibleTableActions.clearFilters();
    expect(
      flexibleTableActions.addColumn({
        label: 'Estimate',
        kind: 'computed',
        formula: 'estimate + 1',
      }),
    ).toMatchObject({ ok: true, value: { id: 'estimate' } });

    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    const cell = rows.find((r) => r.task.id === 'TL-1')?.cells.estimate;
    expect(cell).toMatchObject({ raw: 3, display: '3' });
    expect(cell?.error).toBeUndefined();
  });

  it('still reports a genuine two-column formula cycle as an error', () => {
    flexibleTableActions.addColumn({ label: 'Base', kind: 'free' });
    flexibleTableActions.addColumn({
      label: 'Alpha',
      kind: 'computed',
      formula: 'base + 1',
    });
    flexibleTableActions.removeColumn('base');
    flexibleTableActions.addColumn({
      label: 'Base',
      kind: 'computed',
      formula: 'alpha + 1',
    });

    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    const tl1 = rows.find((r) => r.task.id === 'TL-1');
    expect(tl1?.cells.alpha?.error).toBeDefined();
    expect(tl1?.cells.base?.error).toBeDefined();
  });

  it('evaluates a long doubling chain of computed columns without exponential work', () => {
    flexibleTableActions.addColumn({
      label: 'C1',
      kind: 'computed',
      formula: 'estimate + estimate',
    });
    for (let n = 2; n <= 40; n++) {
      flexibleTableActions.addColumn({
        label: `C${n}`,
        kind: 'computed',
        formula: `c${n - 1} + c${n - 1}`,
      });
    }

    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    expect(rows.find((r) => r.task.id === 'TL-1')?.cells.c40?.raw).toBe(
      2 * 2 ** 40,
    );
  });

  it('rejects gt and lt filters with a non-numeric threshold on numeric columns', () => {
    expect(flexibleTableActions.filterRows('estimate', 'gt', '')).toMatchObject(
      { ok: false, reason: 'invalid_filter_value' },
    );
    expect(
      flexibleTableActions.filterRows('estimate', 'lt', 'abc'),
    ).toMatchObject({ ok: false, reason: 'invalid_filter_value' });

    flexibleTableActions.addColumn({
      label: 'Total',
      kind: 'computed',
      formula: 'estimate + spent',
    });
    expect(flexibleTableActions.filterRows('total', 'gt', '')).toMatchObject({
      ok: false,
      reason: 'invalid_filter_value',
    });
    expect(getFlexibleTableSnapshot().filters).toEqual([]);

    expect(flexibleTableActions.filterRows('title', 'gt', 'm').ok).toBe(true);
    expect(flexibleTableActions.filterRows('estimate', 'gt', '2').ok).toBe(
      true,
    );
  });

  it('sorts mixed numeric and text values in one consistent order', () => {
    projectTaskActions.createTask({ title: 'Third' }); // TL-3
    projectTaskActions.createTask({ title: 'Blank' }); // TL-4
    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });
    flexibleTableActions.sortBy('notes', 'asc');

    const sortedValues = () =>
      projectTableRows(getProjectTasksSnapshot().tasks).map(
        (r) => r.cells.notes?.display,
      );

    flexibleTableActions.setCell('TL-1', 'notes', '0x10');
    flexibleTableActions.setCell('TL-2', 'notes', '1 item');
    flexibleTableActions.setCell('TL-3', 'notes', '2');
    expect(sortedValues()).toEqual(['2', '0x10', '1 item', '']);

    flexibleTableActions.setCell('TL-1', 'notes', '1 item');
    flexibleTableActions.setCell('TL-2', 'notes', '2');
    flexibleTableActions.setCell('TL-3', 'notes', '0x10');
    expect(sortedValues()).toEqual(['2', '0x10', '1 item', '']);
  });

  it('does not resolve inherited object properties as task fields', () => {
    for (const source of ['constructor', 'toString', '__proto__']) {
      expect(
        flexibleTableActions.addColumn({
          label: 'Example',
          kind: 'field',
          source,
        }),
      ).toMatchObject({ ok: false, reason: 'unknown_field' });
    }
    expect(
      flexibleTableActions.addColumn({
        label: 'Bad ref',
        kind: 'computed',
        formula: 'constructor + 1',
      }),
    ).toMatchObject({ ok: false, reason: 'unknown_column' });

    expect(
      flexibleTableActions.addColumn({
        label: 'Owner',
        kind: 'field',
        source: 'owner',
      }),
    ).toMatchObject({ ok: true, value: { field: 'assigneeId' } });
    expect(
      flexibleTableActions.addColumn({
        label: 'Est',
        kind: 'field',
        source: 'estimate',
      }),
    ).toMatchObject({ ok: true, value: { field: 'estimate' } });
  });
});
