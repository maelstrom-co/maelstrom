import type { TableColumn } from './flexible-table-columns';
import { isOpenTask, type ProjectTask } from './project-tasks.store';

export const TABLE_PRESETS = ['default', 'triage'] as const;
export type TablePreset = (typeof TABLE_PRESETS)[number];

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

export function resolvePreset(query: string): TablePreset | undefined {
  const lower = query.trim().toLowerCase();
  return TABLE_PRESETS.find((preset) => preset === lower);
}
