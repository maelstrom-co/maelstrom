import {
  lookupColumn,
  resolveTaskField,
  type TableColumn,
} from './flexible-table-columns';
import { evaluateFormulaNode, parseFormula } from './flexible-table-formula';
import { triageReasonsForTask } from './flexible-table-presets';
import {
  compareCells,
  hasSortableValue,
  matchesFilter,
} from './flexible-table-values';
import {
  type FlexibleTableState,
  getFlexibleTableSnapshot,
} from './flexible-table.store';
import {
  assigneeLabel,
  type ProjectTask,
  TASK_STATUS_NAMES,
} from './project-tasks.store';

export interface ProjectedCell {
  readonly raw: string | number | null;
  readonly display: string;
  readonly error?: string;
}

export interface ProjectedTableRow {
  readonly task: ProjectTask;
  readonly cells: Readonly<Record<string, ProjectedCell>>;
}

interface ProjectedTableGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly ProjectedTableRow[];
}

export function projectTableRows(
  tasks: readonly ProjectTask[],
  tableState: FlexibleTableState = getFlexibleTableSnapshot(),
): readonly ProjectedTableRow[] {
  const parentIds = new Set(tasks.map((task) => task.parentId));
  const projected = tasks.map((task): ProjectedTableRow => {
    const cells: Record<string, ProjectedCell> = {};
    const visiting = new Set<string>();
    const computed = new Map<string, ProjectedCell>();
    for (const column of tableState.columns) {
      cells[column.id] = evaluateCell(
        task,
        column,
        tableState,
        parentIds,
        visiting,
        computed,
      );
    }
    return { task, cells };
  });

  const filtered =
    tableState.filters.length === 0
      ? projected
      : projected.filter((row) =>
          tableState.filters.every((rule) =>
            matchesFilter(row, rule, tableState.columns),
          ),
        );

  if (tableState.sort.length === 0) return filtered;

  const columnById = new Map(tableState.columns.map((col) => [col.id, col]));
  return [...filtered].sort((a, b) => {
    for (const rule of tableState.sort) {
      const column = columnById.get(rule.column);
      if (!column) continue;
      const aCell = a.cells[column.id];
      const bCell = b.cells[column.id];
      const aHas = hasSortableValue(aCell);
      const bHas = hasSortableValue(bCell);
      if (!aHas || !bHas) {
        if (aHas === bHas) continue;
        return aHas ? -1 : 1;
      }
      const cmp = compareCells(aCell, bCell, column);
      if (cmp !== 0) return rule.direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

export function groupProjectedRows(
  rows: readonly ProjectedTableRow[],
  tableState: FlexibleTableState = getFlexibleTableSnapshot(),
): readonly ProjectedTableGroup[] {
  if (!tableState.groupBy) {
    return [{ key: '__all__', label: '', rows }];
  }
  const column = tableState.columns.find(
    (col) => col.id === tableState.groupBy,
  );
  if (!column) {
    return [{ key: '__all__', label: '', rows }];
  }

  const groups = new Map<
    string,
    { label: string; exact: string | null; rows: ProjectedTableRow[] }
  >();
  for (const row of rows) {
    const cell = row.cells[column.id];
    const display = cell?.display ?? '';
    const isBlank = !display.trim();
    const number =
      cell !== undefined &&
      cell.error === undefined &&
      typeof cell.raw === 'number'
        ? cell.raw
        : undefined;
    const label = isBlank ? '(empty)' : display;
    const key = isBlank
      ? ''
      : number !== undefined
        ? `#${number}`
        : display.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, {
        label,
        exact: number === undefined ? null : String(number),
        rows: [row],
      });
    }
  }
  const labelCounts = new Map<string, number>();
  for (const group of groups.values()) {
    labelCounts.set(group.label, (labelCounts.get(group.label) ?? 0) + 1);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    label:
      group.exact !== null && (labelCounts.get(group.label) ?? 0) > 1
        ? group.exact
        : group.label,
    rows: group.rows,
  }));
}

function evaluateCell(
  task: ProjectTask,
  column: TableColumn,
  tableState: FlexibleTableState,
  parentIds: ReadonlySet<string | null>,
  visiting: Set<string>,
  computed: Map<string, ProjectedCell>,
): ProjectedCell {
  if (column.kind === 'free') {
    const value = tableState.cells[column.id]?.[task.id] ?? '';
    return { raw: value, display: value };
  }

  if (column.kind === 'field') {
    return readTaskFieldCell(task, column.field ?? column.id, parentIds);
  }

  if (visiting.has(column.id)) {
    return {
      raw: null,
      display: '#CYCLE',
      error: 'Circular formula reference.',
    };
  }
  const cached = computed.get(column.id);
  if (cached) return cached;
  visiting.add(column.id);

  const parsed = parseFormula(column.formula ?? '');
  if (!parsed.ok) {
    visiting.delete(column.id);
    return cacheCell(computed, column.id, {
      raw: null,
      display: '#ERR',
      error: parsed.message,
    });
  }

  const otherColumns = tableState.columns.filter((col) => col.id !== column.id);
  const evaluated = evaluateFormulaNode(parsed.ast, (ref) => {
    const lookup = lookupColumn(ref, otherColumns);
    if (lookup.kind === 'ambiguous') return { found: true, value: undefined };
    if (lookup.kind === 'found') {
      const cell = evaluateCell(
        task,
        lookup.column,
        tableState,
        parentIds,
        visiting,
        computed,
      );
      if (cell.error) return { found: true, value: undefined };
      return { found: true, value: cell.raw };
    }
    const field = resolveTaskField(ref, [task]);
    if (field) {
      const fieldCell = readTaskFieldCell(task, field, parentIds);
      return { found: true, value: fieldCell.raw };
    }
    return { found: false };
  });

  visiting.delete(column.id);

  if (!evaluated.ok) {
    return cacheCell(computed, column.id, {
      raw: null,
      display: '#ERR',
      error: evaluated.message,
    });
  }
  return cacheCell(computed, column.id, {
    raw: evaluated.value,
    display: formatNumber(evaluated.value),
  });
}

function cacheCell(
  computed: Map<string, ProjectedCell>,
  columnId: string,
  cell: ProjectedCell,
): ProjectedCell {
  computed.set(columnId, cell);
  return cell;
}

function readTaskFieldCell(
  task: ProjectTask,
  field: string,
  parentIds: ReadonlySet<string | null>,
): ProjectedCell {
  if (field === 'triageReason') {
    const text = triageReasonsForTask(task, parentIds).join(', ');
    return { raw: text, display: text };
  }
  if (field === 'assigneeId') {
    const display = assigneeLabel(task.assigneeId);
    return { raw: task.assigneeId, display };
  }
  if (field === 'status') {
    return { raw: task.status, display: TASK_STATUS_NAMES[task.status] };
  }

  const record = task as unknown as Record<string, unknown>;
  const value = Object.hasOwn(record, field) ? record[field] : null;
  if (value === null || value === undefined) {
    return { raw: null, display: '' };
  }
  if (typeof value === 'number') {
    return { raw: value, display: formatNumber(value) };
  }
  return { raw: String(value), display: String(value) };
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}
