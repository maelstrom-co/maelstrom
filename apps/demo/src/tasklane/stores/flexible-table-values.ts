import type { TableColumn } from './flexible-table-columns';
import type {
  ProjectedCell,
  ProjectedTableRow,
} from './flexible-table-projection';
import {
  assigneeLabel,
  isTaskStatus,
  parseIsoDate,
  TASK_STATUS_NAMES,
  TASK_STATUSES,
  TASK_URGENCIES,
  type TaskStatus,
  type TaskUrgency,
} from './project-tasks.store';
import { resolveAssignee, type TeamMemberId } from './team';

export const FILTER_OPS = ['eq', 'neq', 'contains', 'gt', 'lt'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterRule {
  readonly column: string;
  readonly op: FilterOp;
  readonly value: string;
}

type RangeFilterValueKind = 'number' | 'date' | 'status' | 'urgency';

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

const NUMERIC_TASK_FIELDS = new Set(['estimate', 'spent']);
const DATE_TASK_FIELDS = new Set(['createdAt', 'dueDate']);

export function matchesFilter(
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

  if (isUrgencyColumn(column) && (rule.op === 'gt' || rule.op === 'lt')) {
    const threshold = resolveUrgency(rule.value);
    if (threshold === undefined) return false;
    const cmp = URGENCY_RANK[row.task.urgency] - URGENCY_RANK[threshold];
    return rule.op === 'gt' ? cmp > 0 : cmp < 0;
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

export function rangeFilterValueMismatch(
  column: TableColumn,
  value: string,
): RangeFilterValueKind | undefined {
  if (isNumericColumn(column) && toComparableNumber(value) === undefined) {
    return 'number';
  }
  if (isDateColumn(column) && parseIsoDate(value.trim()) === undefined) {
    return 'date';
  }
  if (isStatusColumn(column) && resolveStatus(value) === undefined) {
    return 'status';
  }
  if (isUrgencyColumn(column) && resolveUrgency(value) === undefined) {
    return 'urgency';
  }
  return undefined;
}

export function hasSortableValue(
  cell: ProjectedCell | undefined,
): cell is ProjectedCell {
  return (
    cell !== undefined &&
    cell.error === undefined &&
    cell.raw !== null &&
    !(typeof cell.raw === 'string' && cell.raw.trim() === '')
  );
}

export function compareCells(
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

export function resolveFilterOp(query: string): FilterOp | undefined {
  const lower = query.trim().toLowerCase();
  return FILTER_OPS.find((op) => op === lower);
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

function resolveUrgency(value: string): TaskUrgency | undefined {
  const query = value.trim().toLowerCase();
  return TASK_URGENCIES.find((urgency) => urgency === query);
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

// Task fields other than the numeric ones hold text, so `001` and `1` differ.
function isTextFieldColumn(column: TableColumn): boolean {
  return (
    column.kind === 'field' && !NUMERIC_TASK_FIELDS.has(column.field ?? '')
  );
}

function isStatusColumn(column: TableColumn): boolean {
  return column.kind === 'field' && column.field === 'status';
}

function isUrgencyColumn(column: TableColumn): boolean {
  return column.kind === 'field' && column.field === 'urgency';
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
