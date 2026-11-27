import { TABLE_COLUMN_KINDS, type TableColumn } from './flexible-table-columns';
import { TABLE_PRESETS } from './flexible-table-presets';
import { FILTER_OPS, type FilterOp } from './flexible-table-values';
import { getFlexibleTableSnapshot } from './flexible-table.store';
import {
  type ProjectTask,
  TASK_STATUSES,
  TASK_URGENCIES,
} from './project-tasks.store';

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
      readonly expected: 'number' | 'date' | 'status' | 'urgency';
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

const EXPECTED_FILTER_VALUE = {
  number: 'a numeric value',
  date: 'an ISO date (YYYY-MM-DD)',
  status: `a status (${TASK_STATUSES.join(', ')})`,
  urgency: `an urgency (${TASK_URGENCIES.join(', ')})`,
} as const;

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
      return `Unknown column "${failure.query}". Current columns: ${getFlexibleTableSnapshot()
        .columns.map((c) => `${c.id} (${c.label})`)
        .join(', ')}.`;
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
