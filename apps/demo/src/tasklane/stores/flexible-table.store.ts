import { useSyncExternalStore } from 'react';

import {
  ambiguousColumnFailure,
  columnsReferencing,
  findColumn,
  findFormulaCycle,
  lookupColumn,
  RESERVED_COLUMN_IDS,
  resolveColumnKind,
  resolveTaskField,
  slugify,
  type TableColumn,
  uniqueColumnId,
} from './flexible-table-columns';
import type { FlexibleTableResult } from './flexible-table-failures';
import { parseFormula } from './flexible-table-formula';
import {
  DEFAULT_TABLE_COLUMNS,
  resolvePreset,
  TRIAGE_TABLE_COLUMNS,
  type TablePreset,
} from './flexible-table-presets';
import {
  type FilterRule,
  rangeFilterValueMismatch,
  resolveFilterOp,
} from './flexible-table-values';
import {
  getProjectTasksSnapshot,
  resolveTaskReference,
} from './project-tasks.store';

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
type SortDirection = (typeof SORT_DIRECTIONS)[number];

interface SortRule {
  readonly column: string;
  readonly direction: SortDirection;
}

export interface FlexibleTableState {
  readonly columns: readonly TableColumn[];
  readonly sort: readonly SortRule[];
  readonly filters: readonly FilterRule[];
  readonly groupBy: string | null;
  readonly cells: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly activePreset: TablePreset;
}

interface AddColumnInput {
  readonly label: string;
  readonly kind: string;
  readonly source?: string;
  readonly formula?: string;
}

const INITIAL_STATE: FlexibleTableState = {
  columns: DEFAULT_TABLE_COLUMNS,
  sort: [],
  filters: [],
  groupBy: null,
  cells: {},
  activePreset: 'default',
};

const CLEAR_GROUP_WORDS = new Set(['', ...RESERVED_COLUMN_IDS]);

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
    const resolved = findColumn(columnRef, state.columns);
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
    const resolved = findColumn(columnRef, state.columns);
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
    const resolved = findColumn(columnRef, state.columns);
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
    const resolved = findColumn(columnRef, state.columns);
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
    const resolved = findColumn(columnRef, state.columns);
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
    const resolved = findColumn(columnRef, state.columns);
    if (!resolved.ok) return resolved;
    const found = resolved.column;
    const op = resolveFilterOp(opInput);
    if (!op) {
      return { ok: false, reason: 'unknown_op', query: opInput };
    }
    if (op === 'gt' || op === 'lt') {
      const expected = rangeFilterValueMismatch(found, value);
      if (expected) {
        return {
          ok: false,
          reason: 'invalid_filter_value',
          op,
          value,
          expected,
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
    const resolved = findColumn(columnRef, state.columns);
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

function resolveSortDirection(query: string): SortDirection | undefined {
  const lower = query.trim().toLowerCase();
  return SORT_DIRECTIONS.find((dir) => dir === lower);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: FlexibleTableState): void {
  state = next;
  for (const listener of listeners) listener();
}
