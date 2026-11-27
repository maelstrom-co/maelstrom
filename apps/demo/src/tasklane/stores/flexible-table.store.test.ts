import { beforeEach, describe, expect, it } from 'vitest';

import { flexibleTableVessel } from '../vessels/flexible-table.vessel.def';
import {
  __resetFlexibleTableStoreForTests,
  describeTableFailure,
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

  it('reads the real task due and created dates through field columns', () => {
    expect(
      flexibleTableActions.addColumn({
        label: 'Due',
        kind: 'field',
        source: 'due',
      }),
    ).toMatchObject({ ok: true, value: { id: 'due', field: 'dueDate' } });
    expect(
      flexibleTableActions.addColumn({
        label: 'Created',
        kind: 'field',
        source: 'created at',
      }),
    ).toMatchObject({ ok: true, value: { id: 'created', field: 'createdAt' } });

    const cells = () =>
      projectTableRows(getProjectTasksSnapshot().tasks).map((row) => [
        row.task.id,
        row.cells.due?.display,
        row.cells.created?.display,
      ]);
    expect(cells()).toEqual([
      ['TL-1', '2026-04-17', '2026-04-06'],
      ['TL-2', '', '2026-04-08'],
    ]);

    projectTaskActions.setDueDate('TL-2', '2026-04-10');
    expect(cells()).toEqual([
      ['TL-1', '2026-04-17', '2026-04-06'],
      ['TL-2', '2026-04-10', '2026-04-08'],
    ]);
  });

  it('resolves date fields by name before any task exists', () => {
    projectTaskActions.removeTask('TL-1');
    projectTaskActions.removeTask('TL-2');
    expect(getProjectTasksSnapshot().tasks).toEqual([]);

    expect(
      flexibleTableActions.addColumn({
        label: 'Due',
        kind: 'field',
        source: 'dueDate',
      }),
    ).toMatchObject({ ok: true, value: { field: 'dueDate' } });
    expect(
      flexibleTableActions.addColumn({
        label: 'Created',
        kind: 'field',
        source: 'createdAt',
      }),
    ).toMatchObject({ ok: true, value: { field: 'createdAt' } });
  });

  it('sorts and filters rows by the task due date, keeping undated tasks last', () => {
    projectTaskActions.createTask({ title: 'Undated' }); // TL-3
    projectTaskActions.setDueDate('TL-2', '2026-04-10');
    flexibleTableActions.addColumn({
      label: 'Due',
      kind: 'field',
      source: 'due date',
    });

    const ids = () =>
      projectTableRows(getProjectTasksSnapshot().tasks).map(
        (row) => row.task.id,
      );

    flexibleTableActions.sortBy('due', 'asc', false);
    expect(ids()).toEqual(['TL-2', 'TL-1', 'TL-3']);
    flexibleTableActions.sortBy('due', 'desc', false);
    expect(ids()).toEqual(['TL-1', 'TL-2', 'TL-3']);

    flexibleTableActions.filterRows('due', 'lt', '2026-04-15');
    expect(ids()).toEqual(['TL-2']);
  });

  it('rejects gt and lt filters on a date column when the threshold is not a real date', () => {
    flexibleTableActions.addColumn({
      label: 'Due',
      kind: 'field',
      source: 'due',
    });
    flexibleTableActions.addColumn({
      label: 'Created',
      kind: 'field',
      source: 'created',
    });

    const impossible = flexibleTableActions.filterRows(
      'due',
      'lt',
      '2026-02-30',
    );
    expect(impossible).toMatchObject({
      ok: false,
      reason: 'invalid_filter_value',
      expected: 'date',
    });
    if (impossible.ok) throw new Error('expected a rejected filter');
    expect(describeTableFailure(impossible)).toContain('YYYY-MM-DD');
    expect(
      flexibleTableActions.filterRows('created', 'gt', 'next week'),
    ).toMatchObject({ ok: false, reason: 'invalid_filter_value' });
    expect(getFlexibleTableSnapshot().filters).toEqual([]);

    expect(flexibleTableActions.filterRows('due', 'contains', '2026').ok).toBe(
      true,
    );
    expect(flexibleTableActions.filterRows('due', 'eq', '').ok).toBe(true);
    expect(
      flexibleTableActions.filterRows('due', 'gt', ' 2026-04-01 ').ok,
    ).toBe(true);
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

  it('rejects a computed column whose label would close a formula cycle', () => {
    flexibleTableActions.showPreset('triage');
    flexibleTableActions.clearFilters();
    flexibleTableActions.addColumn({
      label: 'Alpha',
      kind: 'computed',
      formula: 'spent + 1',
    });

    const refused = flexibleTableActions.addColumn({
      label: 'Spent',
      kind: 'computed',
      formula: 'alpha + 1',
    });
    expect(refused).toMatchObject({
      ok: false,
      reason: 'formula_cycle',
      cycle: ['Alpha', 'Spent', 'Alpha'],
    });
    if (refused.ok) throw new Error('expected a formula_cycle failure');
    expect(describeTableFailure(refused)).toContain('Alpha -> Spent -> Alpha');
    expect(
      getFlexibleTableSnapshot().columns.map((col) => col.id),
    ).not.toContain('spent');

    const tl1 = projectTableRows(getProjectTasksSnapshot().tasks).find(
      (r) => r.task.id === 'TL-1',
    );
    expect(tl1?.cells.alpha).toMatchObject({ raw: 2, display: '2' });
    expect(flexibleTableActions.removeColumn('alpha')).toMatchObject({
      ok: true,
    });
  });

  it('rejects a rename that would close a formula cycle', () => {
    flexibleTableActions.showPreset('triage');
    flexibleTableActions.clearFilters();
    flexibleTableActions.addColumn({
      label: 'Alpha',
      kind: 'computed',
      formula: 'spent + 1',
    });
    flexibleTableActions.addColumn({
      label: 'Beta',
      kind: 'computed',
      formula: 'alpha + 1',
    });

    expect(flexibleTableActions.renameColumn('beta', 'Spent')).toMatchObject({
      ok: false,
      reason: 'formula_cycle',
    });
    expect(
      getFlexibleTableSnapshot().columns.find((col) => col.id === 'beta')
        ?.label,
    ).toBe('Beta');
    const tl1 = projectTableRows(getProjectTasksSnapshot().tasks).find(
      (r) => r.task.id === 'TL-1',
    );
    expect(tl1?.cells.beta).toMatchObject({ raw: 3, display: '3' });
    expect(flexibleTableActions.removeColumn('beta')).toMatchObject({
      ok: true,
    });
  });

  it('rejects a removal that would re-bind a reference into a formula cycle', () => {
    flexibleTableActions.addColumn({ label: 'Foo', kind: 'free' });
    flexibleTableActions.renameColumn('foo', 'X');
    flexibleTableActions.addColumn({
      label: 'Sum',
      kind: 'computed',
      formula: 'x + 1',
    });
    flexibleTableActions.addColumn({
      label: 'Bar',
      kind: 'computed',
      formula: 'sum + 1',
    });
    expect(flexibleTableActions.renameColumn('bar', 'X')).toMatchObject({
      ok: true,
    });

    expect(flexibleTableActions.removeColumn('foo')).toMatchObject({
      ok: false,
      reason: 'formula_cycle',
    });
    expect(getFlexibleTableSnapshot().columns.map((col) => col.id)).toContain(
      'foo',
    );
    expect(flexibleTableActions.removeColumn('bar')).toMatchObject({
      ok: true,
    });
    expect(flexibleTableActions.removeColumn('sum')).toMatchObject({
      ok: true,
    });
    expect(flexibleTableActions.removeColumn('foo')).toMatchObject({
      ok: true,
    });
  });

  it('projects a cyclic table state as cell errors without crashing', () => {
    const cyclic = {
      ...getFlexibleTableSnapshot(),
      columns: [
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
      ],
    };

    const rows = projectTableRows(getProjectTasksSnapshot().tasks, cyclic);
    const tl1 = rows.find((r) => r.task.id === 'TL-1');
    expect(tl1?.cells.alpha?.error).toBeDefined();
    expect(tl1?.cells.spent?.error).toBeDefined();
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

  it('rejects a label that matches more than one column', () => {
    flexibleTableActions.addColumn({ label: 'Status Notes', kind: 'free' });
    flexibleTableActions.addColumn({ label: 'Status Notes', kind: 'free' });
    flexibleTableActions.setCell('TL-1', 'status_notes', 'keep');

    const ambiguous = {
      ok: false,
      reason: 'ambiguous_column',
      query: 'Status Notes',
      candidates: [
        'status_notes (Status Notes)',
        'status_notes_2 (Status Notes)',
      ],
    };
    const removed = flexibleTableActions.removeColumn('Status Notes');
    expect(removed).toMatchObject(ambiguous);
    expect(getFlexibleTableSnapshot().columns.map((col) => col.id)).toEqual(
      expect.arrayContaining(['status_notes', 'status_notes_2']),
    );
    expect(getFlexibleTableSnapshot().cells.status_notes).toEqual({
      'TL-1': 'keep',
    });
    if (removed.ok) throw new Error('expected an ambiguous failure');
    const message = describeTableFailure(removed);
    expect(message).toContain('status_notes (Status Notes)');
    expect(message).toContain('status_notes_2 (Status Notes)');

    expect(flexibleTableActions.sortBy('Status Notes')).toMatchObject(
      ambiguous,
    );
    expect(
      flexibleTableActions.setCell('TL-1', 'Status Notes', 'x'),
    ).toMatchObject(ambiguous);
    expect(
      flexibleTableActions.renameColumn('Status Notes', 'Other'),
    ).toMatchObject(ambiguous);
    expect(getFlexibleTableSnapshot().cells.status_notes).toEqual({
      'TL-1': 'keep',
    });

    expect(
      flexibleTableActions.addColumn({
        label: 'Sum',
        kind: 'computed',
        formula: 'status_notes + 1',
      }),
    ).toMatchObject({ ok: true });

    expect(flexibleTableActions.removeColumn('status_notes_2')).toMatchObject({
      ok: true,
      value: { id: 'status_notes_2' },
    });
  });

  it('rejects a single-word label shared by two columns but keeps the exact id', () => {
    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });
    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });

    expect(flexibleTableActions.removeColumn('Notes')).toMatchObject({
      ok: false,
      reason: 'ambiguous_column',
      candidates: ['notes (Notes)', 'notes_2 (Notes)'],
    });
    expect(flexibleTableActions.removeColumn('notes')).toMatchObject({
      ok: true,
      value: { id: 'notes' },
    });
  });

  it('rejects an ambiguous formula reference', () => {
    flexibleTableActions.addColumn({ label: 'Score', kind: 'free' });
    flexibleTableActions.addColumn({ label: 'Score', kind: 'free' });

    expect(
      flexibleTableActions.addColumn({
        label: 'Double',
        kind: 'computed',
        formula: 'Score * 2',
      }),
    ).toMatchObject({ ok: false, reason: 'ambiguous_column', query: 'Score' });
  });

  it('refuses to remove a column that a computed column references', () => {
    flexibleTableActions.showPreset('triage');
    flexibleTableActions.clearFilters();
    flexibleTableActions.addColumn({ label: 'Estimate', kind: 'free' });
    flexibleTableActions.setCell('TL-1', 'estimate', '10');
    flexibleTableActions.addColumn({
      label: 'Plus',
      kind: 'computed',
      formula: 'estimate + 1',
    });

    const refused = flexibleTableActions.removeColumn('estimate');
    expect(refused).toMatchObject({
      ok: false,
      reason: 'column_in_use',
      dependents: ['Plus'],
    });
    if (refused.ok) throw new Error('expected a column_in_use failure');
    expect(describeTableFailure(refused)).toContain('Plus');
    expect(getFlexibleTableSnapshot().columns.map((col) => col.id)).toContain(
      'estimate',
    );
    expect(getFlexibleTableSnapshot().cells.estimate).toEqual({ 'TL-1': '10' });
    const tl1 = projectTableRows(getProjectTasksSnapshot().tasks).find(
      (r) => r.task.id === 'TL-1',
    );
    expect(tl1?.cells.plus).toMatchObject({ raw: 11, display: '11' });

    expect(flexibleTableActions.removeColumn('plus')).toMatchObject({
      ok: true,
    });
    expect(flexibleTableActions.removeColumn('estimate')).toMatchObject({
      ok: true,
    });
  });

  it('still removes a field column when the formula reads the same task field', () => {
    flexibleTableActions.addColumn({
      label: 'Total',
      kind: 'computed',
      formula: 'estimate + spent',
    });

    expect(flexibleTableActions.removeColumn('estimate')).toMatchObject({
      ok: true,
    });
    const tl1 = projectTableRows(getProjectTasksSnapshot().tasks).find(
      (r) => r.task.id === 'TL-1',
    );
    expect(tl1?.cells.total?.raw).toBe(3);
  });

  it('keeps empty cells last when sorting descending', () => {
    projectTaskActions.createTask({ title: 'Third' }); // TL-3
    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });
    flexibleTableActions.setCell('TL-1', 'notes', 'a');
    flexibleTableActions.setCell('TL-3', 'notes', 'b');

    const sorted = (column: string) =>
      projectTableRows(getProjectTasksSnapshot().tasks).map((r) => [
        r.task.id,
        r.cells[column]?.display,
      ]);

    flexibleTableActions.sortBy('notes', 'desc');
    expect(sorted('notes')).toEqual([
      ['TL-3', 'b'],
      ['TL-1', 'a'],
      ['TL-2', ''],
    ]);
    flexibleTableActions.sortBy('notes', 'asc');
    expect(sorted('notes')).toEqual([
      ['TL-1', 'a'],
      ['TL-3', 'b'],
      ['TL-2', ''],
    ]);

    flexibleTableActions.addColumn({
      label: 'Ratio',
      kind: 'computed',
      formula: 'estimate / spent',
    });
    flexibleTableActions.sortBy('ratio', 'desc');
    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    expect(rows.map((r) => r.task.id)).toEqual(['TL-1', 'TL-2', 'TL-3']);
    expect(rows.at(-1)?.cells.ratio?.error).toBeDefined();
  });

  it('groups numeric cells by value even when their labels round alike', () => {
    flexibleTableActions.addColumn({
      label: 'Scaled',
      kind: 'computed',
      formula: 'estimate / 1000',
    });
    flexibleTableActions.groupBy('scaled');

    const groups = groupProjectedRows(
      projectTableRows(getProjectTasksSnapshot().tasks),
    );
    expect(groups.map((group) => group.label)).toEqual(['0.002', '0.004']);
    expect(groups.map((group) => group.rows.map((r) => r.task.id))).toEqual([
      ['TL-1'],
      ['TL-2'],
    ]);
  });

  it('leaves out rows whose numeric cell is not a finite number from range filters', () => {
    projectTaskActions.createTask({
      title: 'Unmeasured',
      estimate: Number.NaN,
    }); // TL-3
    flexibleTableActions.filterRows('estimate', 'gt', '0');

    expect(
      projectTableRows(getProjectTasksSnapshot().tasks).map((r) => r.task.id),
    ).toEqual(['TL-1', 'TL-2']);
  });

  it('does not match unrelated non-ASCII column names through the fallback id', () => {
    flexibleTableActions.addColumn({ label: '予算', kind: 'free' });
    flexibleTableActions.setCell('TL-1', '予算', '100');

    expect(flexibleTableActions.removeColumn('担当')).toMatchObject({
      ok: false,
      reason: 'unknown_column',
    });
    const column = getFlexibleTableSnapshot().columns.find(
      (col) => col.label === '予算',
    );
    expect(column?.id).toBe('col');
    expect(flexibleTableActions.removeColumn('col')).toMatchObject({
      ok: true,
    });
    flexibleTableActions.addColumn({ label: '予算', kind: 'free' });
    expect(flexibleTableActions.removeColumn('予算')).toMatchObject({
      ok: true,
    });
  });

  it('compares task titles as text in equality filters', () => {
    projectTaskActions.createTask({ title: '001' }); // TL-3
    projectTaskActions.createTask({ title: '1' }); // TL-4
    const ids = () =>
      projectTableRows(getProjectTasksSnapshot().tasks).map((r) => r.task.id);

    flexibleTableActions.filterRows('title', 'eq', '001');
    expect(ids()).toEqual(['TL-3']);
    flexibleTableActions.clearFilters();
    flexibleTableActions.filterRows('title', 'neq', '001');
    expect(ids()).toEqual(['TL-1', 'TL-2', 'TL-4']);
    flexibleTableActions.clearFilters();
    flexibleTableActions.filterRows('estimate', 'eq', '2.0');
    expect(ids()).toEqual(['TL-1']);
  });

  it('keeps whitespace-only cells with the blank cells when sorting', () => {
    projectTaskActions.createTask({ title: 'Third' }); // TL-3
    flexibleTableActions.addColumn({ label: 'Notes', kind: 'free' });
    flexibleTableActions.setCell('TL-1', 'notes', '   ');
    flexibleTableActions.setCell('TL-2', 'notes', '2');
    flexibleTableActions.setCell('TL-3', 'notes', '0');

    const ids = () =>
      projectTableRows(getProjectTasksSnapshot().tasks).map((r) => r.task.id);

    flexibleTableActions.sortBy('notes', 'desc');
    expect(ids()).toEqual(['TL-2', 'TL-3', 'TL-1']);
    flexibleTableActions.sortBy('notes', 'asc');
    expect(ids()).toEqual(['TL-3', 'TL-2', 'TL-1']);
  });

  it('moves a computed error ahead of valid rows to the end of a descending sort', () => {
    projectTaskActions.removeTask('TL-1');
    projectTaskActions.removeTask('TL-2');
    projectTaskActions.createTask({ title: 'Zero', estimate: 5, spent: 0 }); // TL-3
    projectTaskActions.createTask({ title: 'Three', estimate: 6, spent: 2 }); // TL-4
    projectTaskActions.createTask({ title: 'Four', estimate: 8, spent: 2 }); // TL-5
    flexibleTableActions.addColumn({
      label: 'Ratio',
      kind: 'computed',
      formula: 'estimate / spent',
    });

    flexibleTableActions.sortBy('ratio', 'desc');
    const rows = projectTableRows(getProjectTasksSnapshot().tasks);
    expect(rows.map((r) => r.task.id)).toEqual(['TL-5', 'TL-4', 'TL-3']);
    expect(rows.map((r) => r.cells.ratio?.raw)).toEqual([4, 3, null]);
    expect(rows.at(-1)?.cells.ratio?.error).toBeDefined();
  });
});
