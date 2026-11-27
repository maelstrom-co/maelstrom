import {
  defineVessel,
  type VesselActionDefinition,
} from '@maelstrom-co/protocol';

import {
  FILTER_OPS,
  SORT_DIRECTIONS,
  TABLE_COLUMN_KINDS,
  TABLE_PRESETS,
} from '../stores/flexible-table.store';
import { TASK_REFERENCE } from './task-action.defs';

const FLEXIBLE_TABLE_DESCRIPTION: string =
  'Flexible task table: a customisable table of tasks with field, computed (arithmetic formula with + - * / and parentheses), and free-text editable columns, multi-column sorting, row filtering, grouping, and a triage view preset. Columns arrive one action at a time via addColumn. Use showPreset("triage") to show only open tasks that have no owner, or that are top-level with no subtasks, along with a reason column ("no owner", or "no parent" for a top-level task with no subtasks). Actions on this Instance run in plan order, so addColumn followed by sortBy on the new column works in one response.';

const FLEXIBLE_TABLE_ACTIONS = [
  {
    name: 'addColumn',
    description:
      'Add one column to the table. For kind "field", pass the task field name in source (e.g. estimate, spent, assignee, status, urgency, title, parent, description, dueDate, createdAt). For kind "computed", pass an arithmetic formula in formula using + - * /, parentheses, and column names (e.g. "estimate + spent"). For kind "free", creates an editable text column.',
    parameters: [
      {
        name: 'label',
        type: 'string',
        description: 'Display header label for the new column.',
      },
      {
        name: 'kind',
        type: 'string',
        enum: [...TABLE_COLUMN_KINDS],
        description: 'Column kind: field, computed, or free.',
      },
      {
        name: 'source',
        type: 'string',
        required: false,
        description: 'Task field name when kind is "field".',
      },
      {
        name: 'formula',
        type: 'string',
        required: false,
        description:
          'Arithmetic formula using + - * /, parentheses, and column references when kind is "computed".',
      },
    ],
  },
  {
    name: 'removeColumn',
    description:
      'Remove a column from the table by its id or label. If a label matches several columns the action fails and lists their ids, then pass the id.',
    parameters: [
      {
        name: 'column',
        type: 'string',
        description: 'Column id or label to remove.',
      },
    ],
  },
  {
    name: 'renameColumn',
    description: 'Rename an existing column header.',
    parameters: [
      {
        name: 'column',
        type: 'string',
        description: 'Column id or label to rename.',
      },
      {
        name: 'label',
        type: 'string',
        description: 'New column label.',
      },
    ],
  },
  {
    name: 'moveColumn',
    effect: 'idempotent',
    description: 'Move a column to a 1-based position in the table.',
    parameters: [
      {
        name: 'column',
        type: 'string',
        description: 'Column id or label to move.',
      },
      {
        name: 'position',
        type: 'number',
        description: '1-based target column position (1 is leftmost).',
      },
    ],
  },
  {
    name: 'setCell',
    effect: 'idempotent',
    description:
      'Set the text value of a cell in a free-text column for a task.',
    parameters: [
      { name: 'task', type: 'string', description: TASK_REFERENCE },
      {
        name: 'column',
        type: 'string',
        description: 'Free column id or label.',
      },
      {
        name: 'value',
        type: 'string',
        description: 'Cell text value to store.',
      },
    ],
  },
  {
    name: 'sortBy',
    effect: 'idempotent',
    description:
      'Sort table rows by a column. Pass add: true to append a secondary sort key (e.g. sort by urgency desc, then assignee asc).',
    parameters: [
      {
        name: 'column',
        type: 'string',
        description: 'Column id or label to sort by.',
      },
      {
        name: 'direction',
        type: 'string',
        enum: [...SORT_DIRECTIONS],
        required: false,
        description: 'Sort direction: asc or desc. Defaults to asc.',
      },
      {
        name: 'add',
        type: 'boolean',
        required: false,
        description:
          'When true, appends this sort rule after existing sort rules instead of replacing them.',
      },
    ],
  },
  {
    name: 'clearSort',
    effect: 'idempotent',
    description: 'Clear all active sort rules.',
    parameters: [],
  },
  {
    name: 'filterRows',
    effect: 'idempotent',
    description:
      'Filter table rows by matching a column against a value using eq, neq, contains, gt, or lt. Multiple filters combine with AND, including several on the same column. Call clearFilters first to replace a filter.',
    parameters: [
      {
        name: 'column',
        type: 'string',
        description: 'Column id or label to filter on.',
      },
      {
        name: 'op',
        type: 'string',
        enum: [...FILTER_OPS],
        description: 'Comparison operator: eq, neq, contains, gt, or lt.',
      },
      {
        name: 'value',
        type: 'string',
        description: 'Value to compare against.',
      },
    ],
  },
  {
    name: 'clearFilters',
    effect: 'idempotent',
    description: 'Clear all active row filters.',
    parameters: [],
  },
  {
    name: 'groupBy',
    effect: 'idempotent',
    description:
      'Group table rows by a column, or pass "none" to ungroup rows.',
    parameters: [
      {
        name: 'column',
        type: 'string',
        description: 'Column id or label to group by, or "none" to clear.',
      },
    ],
  },
  {
    name: 'showPreset',
    effect: 'idempotent',
    description:
      'Switch the table to a preset view. Use "triage" for open tasks with no owner, or top-level open tasks with no subtasks, plus a reason column, or "default" to reset.',
    parameters: [
      {
        name: 'preset',
        type: 'string',
        enum: [...TABLE_PRESETS],
        description: 'Preset name: triage or default.',
      },
    ],
  },
] as const satisfies readonly VesselActionDefinition[];

export const flexibleTableVessel = defineVessel({
  id: 'flexible-table',
  name: 'Flexible table',
  description: FLEXIBLE_TABLE_DESCRIPTION,
  defaultVariant: 'table',
  variants: {
    table: {
      description:
        'Customisable task table with dynamic columns, formulas, sorting, filtering, grouping, and triage preset.',
      props: {},
      minSize: { width: 6, height: 4 },
      actions: FLEXIBLE_TABLE_ACTIONS,
    },
  },
});
