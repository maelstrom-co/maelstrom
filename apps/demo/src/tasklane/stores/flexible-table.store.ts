import { useSyncExternalStore } from 'react';

import { evaluateFormulaNode, parseFormula } from './flexible-table-formula';
import {
  assigneeLabel,
  getProjectTasksSnapshot,
  isOpenTask,
  isTaskStatus,
  parseIsoDate,
  type ProjectTask,
  resolveTaskReference,
  TASK_STATUS_NAMES,
  TASK_STATUSES,
  type TaskStatus,
  type TaskUrgency,
} from './project-tasks.store';
import { resolveAssignee, type TeamMemberId } from './team';

export const TABLE_COLUMN_KINDS = ['field', 'computed', 'free'] as const;
export type TableColumnKind = (typeof TABLE_COLUMN_KINDS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const FILTER_OPS = ['eq', 'neq', 'contains', 'gt', 'lt'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const TABLE_PRESETS = ['default', 'triage'] as const;
export type TablePreset = (typeof TABLE_PRESETS)[number];

export interface TableColumn {
  readonly id: string;
  readonly label: string;
  readonly kind: TableColumnKind;
  readonly field?: string;
  readonly formula?: string;
}

export interface SortRule {
  readonly column: string;
  readonly direction: SortDirection;
}

export interface FilterRule {
  readonly column: string;
  readonly op: FilterOp;
  readonly value: string;
}

export interface FlexibleTableState {
  readonly columns: readonly TableColumn[];
  readonly sort: readonly SortRule[];
  readonly filters: readonly FilterRule[];
  readonly groupBy: string | null;
  readonly cells: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly activePreset: TablePreset;
}

export type FlexibleTableFailure =
  | { readonly ok: false; readonly reason: 'empty_label' }
  | {
      readonly ok: false;
      readonly reason: 'unknown_kind';
      readonly query: string;
    }
  | { readonly ok: false; readonly reason: 'missing_field' }
  | {
      readonly ok: false;
      readonly reason: 'unknown_field';
      readonly query: string;
    }
  | { readonly ok: false; readonly reason: 'missing_formula' }
  | {
      readonly ok: false;
      readonly reason: 'invalid_formula';
      readonly formula: string;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'unknown_column';
      readonly query: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'ambiguous_column';
      readonly query: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'column_in_use';
      readonly column: TableColumn;
      readonly dependents: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'formula_cycle';
      readonly cycle: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'not_free_column';
      readonly column: TableColumn;
    }
  | {
      readonly ok: false;
      readonly reason: 'bad_position';
      readonly position: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'unknown_direction';
      readonly query: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'unknown_op';
      readonly query: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'invalid_filter_value';
      readonly op: FilterOp;
      readonly value: string;
      readonly expected: 'number' | 'date' | 'status';
    }
  | {
      readonly ok: false;
      readonly reason: 'unknown_preset';
      readonly query: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'task_not_found';
      readonly query: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'ambiguous_task';
      readonly query: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'stale_reference';
      readonly query: string;
      readonly task: ProjectTask;
    };

export type FlexibleTableResult<T = undefined> =
  | { readonly ok: true; readonly changed: boolean; readonly value?: T }
  | FlexibleTableFailure;

export interface AddColumnInput {
  readonly label: string;
  readonly kind: string;
  readonly source?: string;
  readonly formula?: string;
}

export interface ProjectedCell {
  readonly raw: string | number | null;
  readonly display: string;
  readonly error?: string;
}

export interface ProjectedTableRow {
  readonly task: ProjectTask;
  readonly cells: Readonly<Record<string, ProjectedCell>>;
}

export interface ProjectedTableGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly ProjectedTableRow[];
}

export const DEFAULT_TABLE_COLUMNS: readonly TableColumn[] = [
  { id: 'id', label: 'ID', kind: 'field', field: 'id' },
  { id: 'title', label: 'Title', kind: 'field', field: 'title' },
  { id: 'assignee', label: 'Assignee', kind: 'field', field: 'assigneeId' },
  { id: 'status', label: 'Status', kind: 'field', field: 'status' },
  { id: 'urgency', label: 'Urgency', kind: 'field', field: 'urgency' },
  { id: 'estimate', label: 'Estimate', kind: 'field', field: 'estimate' },
  { id: 'spent', label: 'Spent', kind: 'field', field: 'spent' },
];

export const TRIAGE_TABLE_COLUMNS: readonly TableColumn[] = [
  { id: 'id', label: 'ID', kind: 'field', field: 'id' },
  { id: 'title', label: 'Title', kind: 'field', field: 'title' },
  { id: 'reason', label: 'Reason', kind: 'field', field: 'triageReason' },
  { id: 'assignee', label: 'Assignee', kind: 'field', field: 'assigneeId' },
  { id: 'status', label: 'Status', kind: 'field', field: 'status' },
  { id: 'urgency', label: 'Urgency', kind: 'field', field: 'urgency' },
];

const INITIAL_STATE: FlexibleTableState = {
  columns: DEFAULT_TABLE_COLUMNS,
  sort: [],
  filters: [],
  groupBy: null,
  cells: {},
  activePreset: 'default',
};

const KNOWN_TASK_FIELDS = new Set<string>([
  'id',
  'title',
  'description',
  'parentId',
  'assigneeId',
  'urgency',
  'status',
  'createdAt',
  'dueDate',
  'sourceFeedback',
  'estimate',
  'spent',
  'triageReason',
]);

const FIELD_ALIASES: Readonly<Record<string, string>> = {
  id: 'id',
  title: 'title',
  description: 'description',
  parent: 'parentId',
  parentid: 'parentId',
  parent_id: 'parentId',
  assignee: 'assigneeId',
  owner: 'assigneeId',
  assigneeid: 'assigneeId',
  assignee_id: 'assigneeId',
  urgency: 'urgency',
  status: 'status',
  created: 'createdAt',
  createdat: 'createdAt',
  created_at: 'createdAt',
  due: 'dueDate',
  duedate: 'dueDate',
  due_date: 'dueDate',
  source: 'sourceFeedback',
  feedback: 'sourceFeedback',
  sourcefeedback: 'sourceFeedback',
  source_feedback: 'sourceFeedback',
  estimate: 'estimate',
  spent: 'spent',
  reason: 'triageReason',
  triagereason: 'triageReason',
  triage_reason: 'triageReason',
};

const URGENCY_RANK: Readonly<Record<TaskUrgency, number>> = {
  low: 0,
  normal: 1,
  high: 2,
};

const STATUS_RANK: Readonly<Record<TaskStatus, number>> = {
  todo: 0,
  doing: 1,
  done: 2,
};

const RESERVED_COLUMN_IDS = ['none', 'clear', 'ungroup'];

const CLEAR_GROUP_WORDS = new Set(['', ...RESERVED_COLUMN_IDS]);

const NUMERIC_TASK_FIELDS = new Set(['estimate', 'spent']);
const DATE_TASK_FIELDS = new Set(['createdAt', 'dueDate']);
const EXPECTED_FILTER_VALUE = {
  number: 'a numeric value',
  date: 'an ISO date (YYYY-MM-DD)',
  status: `a status (${TASK_STATUSES.join(', ')})`,
} as const;

let state: FlexibleTableState = INITIAL_STATE;
const listeners = new Set<() => void>();

export function useFlexibleTableStore(): FlexibleTableState {
  return useSyncExternalStore(
    subscribe,
    getFlexibleTableSnapshot,
    getFlexibleTableSnapshot,
  );
}

export function getFlexibleTableSnapshot(): FlexibleTableState {
  return state;
}

export function __resetFlexibleTableStoreForTests(): void {
  setState(INITIAL_STATE);
}

export const flexibleTableActions = {
  addColumn(input: AddColumnInput): FlexibleTableResult<TableColumn> {
    const label = input.label.trim();
    if (!label) return { ok: false, reason: 'empty_label' };

    const kind = resolveColumnKind(input.kind);
    if (!kind) return { ok: false, reason: 'unknown_kind', query: input.kind };

    const tasks = getProjectTasksSnapshot().tasks;

    if (kind === 'field') {
      const requested = (input.source ?? label).trim();
      if (!requested) return { ok: false, reason: 'missing_field' };
      const field = resolveTaskField(requested, tasks);
      if (!field) {
        return { ok: false, reason: 'unknown_field', query: requested };
      }
      const id = uniqueColumnId(slugify(label), state.columns);
      const column: TableColumn = { id, label, kind: 'field', field };
      setState({ ...state, columns: [...state.columns, column] });
      return { ok: true, changed: true, value: column };
    }

    if (kind === 'computed') {
      const formula = input.formula?.trim() ?? '';
      if (!formula) return { ok: false, reason: 'missing_formula' };
      const parsed = parseFormula(formula);
      if (!parsed.ok) {
        return {
          ok: false,
          reason: 'invalid_formula',
          formula,
          message: parsed.message,
        };
      }
      for (const ref of parsed.references) {
        const lookup = lookupColumn(ref, state.columns);
        if (lookup.kind === 'ambiguous') {
          return ambiguousColumnFailure(ref, lookup.candidates);
        }
        if (lookup.kind === 'not_found' && !resolveTaskField(ref, tasks)) {
          return { ok: false, reason: 'unknown_column', query: ref };
        }
      }
      const id = uniqueColumnId(slugify(label), state.columns);
      const column: TableColumn = { id, label, kind: 'computed', formula };
      const columns = [...state.columns, column];
      const cycle = findFormulaCycle(columns);
      if (cycle) return { ok: false, reason: 'formula_cycle', cycle };
      setState({ ...state, columns });
      return { ok: true, changed: true, value: column };
    }

    const id = uniqueColumnId(slugify(label), state.columns);
    const column: TableColumn = { id, label, kind: 'free' };
    setState({ ...state, columns: [...state.columns, column] });
    return { ok: true, changed: true, value: column };
  },

  removeColumn(columnRef: string): FlexibleTableResult<TableColumn> {
    const resolved = findColumn(columnRef);
    if (!resolved.ok) return resolved;
    const found = resolved.column;
    const dependents = columnsReferencing(
      found,
      state.columns,
      getProjectTasksSnapshot().tasks,
    );
    if (dependents.length > 0) {
      return { ok: false, reason: 'column_in_use', column: found, dependents };
    }
    const columns = state.columns.filter((col) => col.id !== found.id);
    const cycle = findFormulaCycle(columns);
    if (cycle) return { ok: false, reason: 'formula_cycle', cycle };
    const { [found.id]: _removed, ...restCells } = state.cells;
    setState({
      ...state,
      columns,
      sort: state.sort.filter((rule) => rule.column !== found.id),
      filters: state.filters.filter((rule) => rule.column !== found.id),
      groupBy: state.groupBy === found.id ? null : state.groupBy,
      cells: restCells,
    });
    return { ok: true, changed: true, value: found };
  },

  renameColumn(
    columnRef: string,
    newLabel: string,
  ): FlexibleTableResult<TableColumn> {
    const label = newLabel.trim();
    if (!label) return { ok: false, reason: 'empty_label' };
    const resolved = findColumn(columnRef);
    if (!resolved.ok) return resolved;
    const found = resolved.column;
    if (found.label === label) {
      return { ok: true, changed: false, value: found };
    }
    const updated: TableColumn = { ...found, label };
    const columns = state.columns.map((col) =>
      col.id === found.id ? updated : col,
    );
    const cycle = findFormulaCycle(columns);
    if (cycle) return { ok: false, reason: 'formula_cycle', cycle };
    setState({ ...state, columns });
    return { ok: true, changed: true, value: updated };
  },

  moveColumn(
    columnRef: string,
    position: number,
  ): FlexibleTableResult<TableColumn> {
    if (!Number.isInteger(position) || position < 1) {
      return { ok: false, reason: 'bad_position', position };
    }
    const resolved = findColumn(columnRef);
    if (!resolved.ok) return resolved;
    const found = resolved.column;
    const currentIndex = state.columns.findIndex((col) => col.id === found.id);
    const targetIndex = Math.min(position - 1, state.columns.length - 1);
    if (currentIndex === targetIndex) {
      return { ok: true, changed: false, value: found };
    }
    const others = state.columns.filter((col) => col.id !== found.id);
    const columns = [
      ...others.slice(0, targetIndex),
      found,
      ...others.slice(targetIndex),
    ];
    setState({ ...state, columns });
    return { ok: true, changed: true, value: found };
  },

  setCell(
    taskRef: string,
    columnRef: string,
    value: string,
  ): FlexibleTableResult {
    const resolved = findColumn(columnRef);
    if (!resolved.ok) return resolved;
    const foundColumn = resolved.column;
    if (foundColumn.kind !== 'free') {
      return { ok: false, reason: 'not_free_column', column: foundColumn };
    }
    const match = resolveTaskReference(taskRef);
    if (match.kind === 'not_found') {
      return { ok: false, reason: 'task_not_found', query: taskRef };
    }
    if (match.kind === 'ambiguous') {
      return {
        ok: false,
        reason: 'ambiguous_task',
        query: taskRef,
        candidates: match.candidates,
      };
    }
    if (match.kind === 'stale') {
      return {
        ok: false,
        reason: 'stale_reference',
        query: taskRef,
        task: match.task,
      };
    }

    const columnCells = state.cells[foundColumn.id] ?? {};
    const previous = columnCells[match.task.id] ?? '';
    if (previous === value) return { ok: true, changed: false };
    setState({
      ...state,
      cells: {
        ...state.cells,
        [foundColumn.id]: {
          ...columnCells,
          [match.task.id]: value,
        },
      },
    });
    return { ok: true, changed: true };
  },

  sortBy(
    columnRef: string,
    directionInput = 'asc',
    add = false,
  ): FlexibleTableResult<SortRule> {
    const resolved = findColumn(columnRef);
    if (!resolved.ok) return resolved;
    const found = resolved.column;
    const direction = resolveSortDirection(directionInput);
    if (!direction) {
      return { ok: false, reason: 'unknown_direction', query: directionInput };
    }
    const rule: SortRule = { column: found.id, direction };
    const nextSort = add
      ? [...state.sort.filter((existing) => existing.column !== found.id), rule]
      : [rule];
    const changed =
      nextSort.length !== state.sort.length ||
      nextSort.some(
        (item, index) =>
          item.column !== state.sort[index]?.column ||
          item.direction !== state.sort[index]?.direction,
      );
    if (changed) setState({ ...state, sort: nextSort });
    return { ok: true, changed, value: rule };
  },

  clearSort(): FlexibleTableResult {
    if (state.sort.length === 0) return { ok: true, changed: false };
    setState({ ...state, sort: [] });
    return { ok: true, changed: true };
  },

  filterRows(
    columnRef: string,
    opInput: string,
    value: string,
  ): FlexibleTableResult<FilterRule> {
    const resolved = findColumn(columnRef);
    if (!resolved.ok) return resolved;
    const found = resolved.column;
    const op = resolveFilterOp(opInput);
    if (!op) {
      return { ok: false, reason: 'unknown_op', query: opInput };
    }
    if (op === 'gt' || op === 'lt') {
      if (isNumericColumn(found) && toComparableNumber(value) === undefined) {
        return {
          ok: false,
          reason: 'invalid_filter_value',
          op,
          value,
          expected: 'number',
        };
      }
      if (isDateColumn(found) && parseIsoDate(value.trim()) === undefined) {
        return {
          ok: false,
          reason: 'invalid_filter_value',
          op,
          value,
          expected: 'date',
        };
      }
      if (isStatusColumn(found) && resolveStatus(value) === undefined) {
        return {
          ok: false,
          reason: 'invalid_filter_value',
          op,
          value,
          expected: 'status',
        };
      }
    }
    const rule: FilterRule = { column: found.id, op, value };
    const exists = state.filters.some(
      (item) =>
        item.column === found.id && item.op === op && item.value === value,
    );
    if (exists) return { ok: true, changed: false, value: rule };
    setState({ ...state, filters: [...state.filters, rule] });
    return { ok: true, changed: true, value: rule };
  },

  clearFilters(): FlexibleTableResult {
    if (state.filters.length === 0) return { ok: true, changed: false };
    setState({ ...state, filters: [] });
    return { ok: true, changed: true };
  },

  groupBy(columnRef: string): FlexibleTableResult<string | null> {
    const normalized = columnRef.trim().toLowerCase();
    if (CLEAR_GROUP_WORDS.has(normalized)) {
      if (state.groupBy === null) {
        return { ok: true, changed: false, value: null };
      }
      setState({ ...state, groupBy: null });
      return { ok: true, changed: true, value: null };
    }
    const resolved = findColumn(columnRef);
    if (!resolved.ok) return resolved;
    const found = resolved.column;
    if (state.groupBy === found.id) {
      return { ok: true, changed: false, value: found.id };
    }
    setState({ ...state, groupBy: found.id });
    return { ok: true, changed: true, value: found.id };
  },

  showPreset(presetInput: string): FlexibleTableResult<TablePreset> {
    const preset = resolvePreset(presetInput);
    if (!preset) {
      return { ok: false, reason: 'unknown_preset', query: presetInput };
    }
    if (preset === 'triage') {
      setState({
        ...state,
        columns: TRIAGE_TABLE_COLUMNS,
        sort: [],
        filters: [{ column: 'reason', op: 'neq', value: '' }],
        groupBy: null,
        cells: {},
        activePreset: 'triage',
      });
      return { ok: true, changed: true, value: 'triage' };
    }
    setState({
      ...state,
      columns: DEFAULT_TABLE_COLUMNS,
      sort: [],
      filters: [],
      groupBy: null,
      cells: {},
      activePreset: 'default',
    });
    return { ok: true, changed: true, value: 'default' };
  },
};

export function describeTableFailure(failure: FlexibleTableFailure): string {
  switch (failure.reason) {
    case 'empty_label':
      return 'Column label cannot be empty.';
    case 'unknown_kind':
      return `Column kind must be one of ${TABLE_COLUMN_KINDS.join(', ')}, got "${failure.query}".`;
    case 'missing_field':
      return 'Field columns require a source field name.';
    case 'unknown_field':
      return `Unknown task field "${failure.query}".`;
    case 'missing_formula':
      return 'Computed columns require a formula.';
    case 'invalid_formula':
      return `Invalid formula "${failure.formula}": ${failure.message}`;
    case 'unknown_column':
      return `Unknown column "${failure.query}". Current columns: ${state.columns.map((c) => `${c.id} (${c.label})`).join(', ')}.`;
    case 'ambiguous_column':
      return `"${failure.query}" matches more than one column: ${failure.candidates.join(', ')}. Use the column id.`;
    case 'column_in_use':
      return `Column "${failure.column.label}" is used by computed column(s) ${failure.dependents.join(', ')}. Remove those first.`;
    case 'formula_cycle':
      return `That change would make computed columns reference each other in a circle: ${failure.cycle.join(' -> ')}. Use a different label, or remove one of those columns first.`;
    case 'not_free_column':
      return `Column "${failure.column.label}" is a ${failure.column.kind} column and cannot be edited directly.`;
    case 'bad_position':
      return `Column position must be a whole number of at least 1, got ${failure.position}.`;
    case 'unknown_direction':
      return `Sort direction must be asc or desc, got "${failure.query}".`;
    case 'unknown_op':
      return `Filter op must be one of ${FILTER_OPS.join(', ')}, got "${failure.query}".`;
    case 'invalid_filter_value':
      return `Filter "${failure.op}" needs ${EXPECTED_FILTER_VALUE[failure.expected]} for this column, got "${failure.value}".`;
    case 'unknown_preset':
      return `Preset must be one of ${TABLE_PRESETS.join(', ')}, got "${failure.query}".`;
    case 'task_not_found':
      return `No task matches "${failure.query}".`;
    case 'ambiguous_task':
      return `"${failure.query}" matches more than one task: ${failure.candidates.join(', ')}.`;
    case 'stale_reference':
      return `"${failure.query}" is out of date for ${failure.task.id}.`;
  }
}

export function projectTableRows(
  tasks: readonly ProjectTask[],
  tableState: FlexibleTableState = state,
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
  tableState: FlexibleTableState = state,
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

export function triageReasonsForTask(
  task: ProjectTask,
  parentIds: ReadonlySet<string | null>,
): readonly ('no owner' | 'no parent')[] {
  if (!isOpenTask(task)) return [];
  const reasons: ('no owner' | 'no parent')[] = [];
  if (task.assigneeId === null) reasons.push('no owner');
  if (task.parentId === null && !parentIds.has(task.id)) {
    reasons.push('no parent');
  }
  return reasons;
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

function matchesFilter(
  row: ProjectedTableRow,
  rule: FilterRule,
  columns: readonly TableColumn[],
): boolean {
  const column = columns.find((col) => col.id === rule.column);
  const cell = row.cells[rule.column];
  if (!column || !cell || cell.error) return false;

  if (column.kind === 'field' && column.field === 'assigneeId') {
    return matchesAssigneeFilter(row.task.assigneeId, rule.op, rule.value);
  }

  if (column.kind === 'field' && column.field === 'status') {
    return matchesStatusFilter(row.task.status, rule.op, rule.value);
  }

  const cellRaw = cell.raw;
  const query = rule.value.trim();

  if (rule.op === 'contains') {
    const haystack = cell.display.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  const leftNum = toComparableNumber(cellRaw);
  const rightNum = toComparableNumber(query);

  if (rule.op === 'gt' || rule.op === 'lt') {
    if (leftNum !== undefined && rightNum !== undefined) {
      return rule.op === 'gt' ? leftNum > rightNum : leftNum < rightNum;
    }
    if (isNumericColumn(column)) return false;
    if (cellRaw === null || cellRaw === '') return false;
    const cmp = String(cellRaw).localeCompare(query, undefined, {
      sensitivity: 'base',
    });
    return rule.op === 'gt' ? cmp > 0 : cmp < 0;
  }

  let equals: boolean;
  if (
    leftNum !== undefined &&
    rightNum !== undefined &&
    !isTextFieldColumn(column)
  ) {
    equals = leftNum === rightNum;
  } else {
    const rawStr = cellRaw === null ? '' : String(cellRaw).trim().toLowerCase();
    const displayStr = cell.display.trim().toLowerCase();
    const wanted = query.toLowerCase();
    equals = rawStr === wanted || displayStr === wanted;
  }

  return rule.op === 'eq' ? equals : !equals;
}

function matchesAssigneeFilter(
  assigneeId: TeamMemberId | null,
  op: FilterOp,
  value: string,
): boolean {
  const display = assigneeLabel(assigneeId).toLowerCase();
  const query = value.trim().toLowerCase();
  if (op === 'contains') {
    return (
      display.includes(query) ||
      (assigneeId !== null && assigneeId.includes(query))
    );
  }
  const resolved = resolveAssignee(value);
  const equals =
    resolved !== undefined ? assigneeId === resolved : display === query;
  if (op === 'eq') return equals;
  if (op === 'neq') return !equals;
  const cmp = display.localeCompare(query);
  return op === 'gt' ? cmp > 0 : cmp < 0;
}

function matchesStatusFilter(
  status: TaskStatus,
  op: FilterOp,
  value: string,
): boolean {
  const query = value.trim().toLowerCase();
  const display = TASK_STATUS_NAMES[status].toLowerCase();
  if (op === 'contains') {
    return status.includes(query) || display.includes(query);
  }
  const equals = status === query || display === query;
  if (op === 'eq') return equals;
  if (op === 'neq') return !equals;
  const threshold = resolveStatus(value);
  if (threshold === undefined) return false;
  const cmp = STATUS_RANK[status] - STATUS_RANK[threshold];
  return op === 'gt' ? cmp > 0 : cmp < 0;
}

function resolveStatus(value: string): TaskStatus | undefined {
  const query = value.trim().toLowerCase();
  if (isTaskStatus(query)) return query;
  return TASK_STATUSES.find(
    (status) => TASK_STATUS_NAMES[status].toLowerCase() === query,
  );
}

function hasSortableValue(
  cell: ProjectedCell | undefined,
): cell is ProjectedCell {
  return (
    cell !== undefined &&
    cell.error === undefined &&
    cell.raw !== null &&
    !(typeof cell.raw === 'string' && cell.raw.trim() === '')
  );
}

function compareCells(
  a: ProjectedCell,
  b: ProjectedCell,
  column: TableColumn,
): number {
  if (column.kind === 'field' && column.field === 'urgency') {
    const aRank = URGENCY_RANK[a.raw as TaskUrgency] ?? -1;
    const bRank = URGENCY_RANK[b.raw as TaskUrgency] ?? -1;
    return aRank - bRank;
  }

  if (column.kind === 'field' && column.field === 'status') {
    const aRank = STATUS_RANK[a.raw as TaskStatus] ?? -1;
    const bRank = STATUS_RANK[b.raw as TaskStatus] ?? -1;
    return aRank - bRank;
  }

  const aNum = toComparableNumber(a.raw);
  const bNum = toComparableNumber(b.raw);
  if (aNum !== undefined && bNum !== undefined) {
    return aNum - bNum;
  }
  if (aNum !== undefined) return -1;
  if (bNum !== undefined) return 1;

  return a.display.localeCompare(b.display, undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

function findColumn(
  columnRef: string,
): { readonly ok: true; readonly column: TableColumn } | FlexibleTableFailure {
  const lookup = lookupColumn(columnRef, state.columns);
  if (lookup.kind === 'found') return { ok: true, column: lookup.column };
  if (lookup.kind === 'ambiguous') {
    return ambiguousColumnFailure(columnRef, lookup.candidates);
  }
  return { ok: false, reason: 'unknown_column', query: columnRef };
}

function ambiguousColumnFailure(
  query: string,
  candidates: readonly TableColumn[],
): FlexibleTableFailure {
  return {
    ok: false,
    reason: 'ambiguous_column',
    query,
    candidates: candidates.map((col) => `${col.id} (${col.label})`),
  };
}

type ColumnLookup =
  | { readonly kind: 'found'; readonly column: TableColumn }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly TableColumn[];
    }
  | { readonly kind: 'not_found' };

function lookupColumn(
  query: string,
  columns: readonly TableColumn[],
): ColumnLookup {
  const exact = query.trim();
  if (!exact) return { kind: 'not_found' };
  const lower = exact.toLowerCase();
  const slug = slugKey(lower);
  const aliasedField = lookupFieldAlias(lower) ?? lookupFieldAlias(slug);

  const tiers: readonly ((col: TableColumn) => boolean)[] = [
    (col) => col.id === exact,
    (col) => col.label.trim().toLowerCase() === lower,
    (col) => slug !== '' && slugKey(col.label) === slug,
    (col) => col.id.toLowerCase() === lower,
    (col) =>
      col.kind === 'field' &&
      col.field !== undefined &&
      (col.field.toLowerCase() === lower ||
        (aliasedField !== undefined && col.field === aliasedField)),
  ];
  for (const matches of tiers) {
    const hits = columns.filter(matches);
    if (hits.length === 1) return { kind: 'found', column: hits[0] };
    if (hits.length > 1) return { kind: 'ambiguous', candidates: hits };
  }
  return { kind: 'not_found' };
}

function columnsReferencing(
  target: TableColumn,
  columns: readonly TableColumn[],
  tasks: readonly ProjectTask[],
): readonly string[] {
  const dependents: string[] = [];
  for (const col of columns) {
    if (col.kind !== 'computed' || col.id === target.id) continue;
    const parsed = parseFormula(col.formula ?? '');
    if (!parsed.ok) continue;
    const others = columns.filter((other) => other.id !== col.id);
    const remaining = others.filter((other) => other.id !== target.id);
    const blocks = parsed.references.some((ref) => {
      const lookup = lookupColumn(ref, others);
      if (lookup.kind !== 'found' || lookup.column.id !== target.id) {
        return false;
      }
      const readsSameTaskField =
        target.kind === 'field' &&
        lookupColumn(ref, remaining).kind === 'not_found' &&
        resolveTaskField(ref, tasks) === (target.field ?? target.id);
      return !readsSameTaskField;
    });
    if (blocks) dependents.push(col.label);
  }
  return dependents;
}

function findFormulaCycle(
  columns: readonly TableColumn[],
): readonly string[] | undefined {
  const edges = new Map<string, readonly TableColumn[]>();
  for (const col of columns) {
    if (col.kind !== 'computed') continue;
    const parsed = parseFormula(col.formula ?? '');
    if (!parsed.ok) continue;
    const others = columns.filter((other) => other.id !== col.id);
    edges.set(
      col.id,
      parsed.references.flatMap((ref) => {
        const lookup = lookupColumn(ref, others);
        return lookup.kind === 'found' && lookup.column.kind === 'computed'
          ? [lookup.column]
          : [];
      }),
    );
  }

  const settled = new Set<string>();
  const path: TableColumn[] = [];
  const visit = (col: TableColumn): readonly string[] | undefined => {
    const start = path.findIndex((onPath) => onPath.id === col.id);
    if (start !== -1) {
      return [...path.slice(start), col].map((onPath) => onPath.label);
    }
    if (settled.has(col.id)) return undefined;
    path.push(col);
    for (const next of edges.get(col.id) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    settled.add(col.id);
    return undefined;
  };
  for (const col of columns) {
    const cycle = visit(col);
    if (cycle) return cycle;
  }
  return undefined;
}

function resolveTaskField(
  query: string,
  tasks: readonly ProjectTask[],
): string | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const slug = slugKey(trimmed);

  const alias = lookupFieldAlias(lower) ?? lookupFieldAlias(slug);
  if (alias) return alias;

  for (const field of KNOWN_TASK_FIELDS) {
    if (field.toLowerCase() === lower) return field;
  }

  for (const task of tasks) {
    for (const key of Object.keys(task)) {
      if (key.toLowerCase() === lower || (slug !== '' && slugKey(key) === slug))
        return key;
    }
  }

  return undefined;
}

function lookupFieldAlias(key: string): string | undefined {
  return Object.hasOwn(FIELD_ALIASES, key) ? FIELD_ALIASES[key] : undefined;
}

// Task fields other than the numeric ones hold text, so `001` and `1` differ.
function isTextFieldColumn(column: TableColumn): boolean {
  return (
    column.kind === 'field' && !NUMERIC_TASK_FIELDS.has(column.field ?? '')
  );
}

function isStatusColumn(column: TableColumn): boolean {
  return column.kind === 'field' && column.field === 'status';
}

function isDateColumn(column: TableColumn): boolean {
  return column.kind === 'field' && DATE_TASK_FIELDS.has(column.field ?? '');
}

function isNumericColumn(column: TableColumn): boolean {
  return (
    column.kind === 'computed' ||
    (column.kind === 'field' && NUMERIC_TASK_FIELDS.has(column.field ?? ''))
  );
}

function resolveColumnKind(query: string): TableColumnKind | undefined {
  const lower = query.trim().toLowerCase();
  return TABLE_COLUMN_KINDS.find((kind) => kind === lower);
}

function resolveSortDirection(query: string): SortDirection | undefined {
  const lower = query.trim().toLowerCase();
  return SORT_DIRECTIONS.find((dir) => dir === lower);
}

function resolveFilterOp(query: string): FilterOp | undefined {
  const lower = query.trim().toLowerCase();
  return FILTER_OPS.find((op) => op === lower);
}

function resolvePreset(query: string): TablePreset | undefined {
  const lower = query.trim().toLowerCase();
  return TABLE_PRESETS.find((preset) => preset === lower);
}

function slugify(value: string): string {
  return slugKey(value) || 'col';
}

// Empty for a name with no ASCII letters or digits, so such names never
// match each other through the slug.
function slugKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function uniqueColumnId(base: string, columns: readonly TableColumn[]): string {
  const taken = new Set([
    ...RESERVED_COLUMN_IDS,
    ...columns.map((col) => col.id.toLowerCase()),
  ]);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

function toComparableNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: FlexibleTableState): void {
  state = next;
  for (const listener of listeners) listener();
}
