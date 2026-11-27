import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { Fragment } from 'react';

import { tasklaneM } from '../maelstrom';
import type { TableColumn } from '../stores/flexible-table-columns';
import {
  describeTableFailure,
  type FlexibleTableResult,
} from '../stores/flexible-table-failures';
import {
  groupProjectedRows,
  projectTableRows,
} from '../stores/flexible-table-projection';
import {
  flexibleTableActions,
  useFlexibleTableStore,
} from '../stores/flexible-table.store';
import { useProjectTasksStore } from '../stores/project-tasks.store';
import { recordFailure, recordUnchanged } from '../tasklane-activity';
import { TasklaneCard } from '../tasklane-card';
import type { flexibleTableVessel } from './flexible-table.vessel';

export default function FlexibleTableComponent({
  instanceId,
  executeAction,
}: TypedVesselProps<typeof flexibleTableVessel>) {
  const { tasks } = useProjectTasksStore();
  const table = useFlexibleTableStore();

  tasklaneM.useActions('flexible-table', instanceId, {
    addColumn: async ({ label, kind, source, formula }) =>
      reportTableResult(
        'addColumn',
        flexibleTableActions.addColumn({ label, kind, source, formula }),
      ),
    removeColumn: async ({ column }) =>
      reportTableResult(
        'removeColumn',
        flexibleTableActions.removeColumn(column),
      ),
    renameColumn: async ({ column, label }) =>
      reportTableResult(
        'renameColumn',
        flexibleTableActions.renameColumn(column, label),
      ),
    moveColumn: async ({ column, position }) =>
      reportTableResult(
        'moveColumn',
        flexibleTableActions.moveColumn(column, position),
      ),
    setCell: async ({ task, column, value }) =>
      reportTableResult(
        'setCell',
        flexibleTableActions.setCell(task, column, value),
      ),
    sortBy: async ({ column, direction, add }) =>
      reportTableResult(
        'sortBy',
        flexibleTableActions.sortBy(column, direction, add),
      ),
    clearSort: async () =>
      reportTableResult('clearSort', flexibleTableActions.clearSort()),
    filterRows: async ({ column, op, value }) =>
      reportTableResult(
        'filterRows',
        flexibleTableActions.filterRows(column, op, value),
      ),
    clearFilters: async () =>
      reportTableResult('clearFilters', flexibleTableActions.clearFilters()),
    groupBy: async ({ column }) =>
      reportTableResult('groupBy', flexibleTableActions.groupBy(column)),
    showPreset: async ({ preset }) =>
      reportTableResult('showPreset', flexibleTableActions.showPreset(preset)),
  });

  const rows = projectTableRows(tasks, table);
  const groups = groupProjectedRows(rows, table);
  const title =
    table.activePreset === 'triage' ? 'Triage table' : 'Flexible table';
  const meta = `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;

  return (
    <TasklaneCard title={title} meta={meta}>
      {(table.filters.length > 0 ||
        table.sort.length > 0 ||
        table.groupBy !== null) && (
        <div
          aria-label="Table controls"
          className="flex flex-wrap items-center gap-1.5 pb-2 text-xs text-ink-3"
        >
          {table.filters.length > 0 && (
            <button
              type="button"
              onClick={() => executeAction('clearFilters')}
              className="rounded border px-1.5 py-0.5 font-mono text-xs"
            >
              Filters ({table.filters.length}) ×
            </button>
          )}
          {table.sort.length > 0 && (
            <button
              type="button"
              onClick={() => executeAction('clearSort')}
              className="rounded border px-1.5 py-0.5 font-mono text-xs"
            >
              Sort ({table.sort.length}) ×
            </button>
          )}
          {table.groupBy !== null && (
            <button
              type="button"
              onClick={() => executeAction('groupBy', { column: 'none' })}
              className="rounded border px-1.5 py-0.5 font-mono text-xs"
            >
              Grouped by {table.groupBy} ×
            </button>
          )}
        </div>
      )}

      <div
        className="flex-1 min-h-0 overflow-auto"
        data-preset={table.activePreset}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-ink-3">
            {table.activePreset === 'triage'
              ? 'Inbox clear ✓'
              : 'No matching tasks'}
          </p>
        ) : (
          <table
            aria-label="Flexible table"
            className="w-full border-collapse text-left text-sm"
          >
            <thead>
              <tr className="border-b text-xs font-mono text-ink-3">
                {table.columns.map((column) => {
                  const sortIndex = table.sort.findIndex(
                    (rule) => rule.column === column.id,
                  );
                  const sortRule =
                    sortIndex === -1 ? undefined : table.sort[sortIndex];
                  const nextDirection =
                    sortRule?.direction === 'asc' ? 'desc' : 'asc';
                  const sortLabel =
                    sortRule?.direction === 'asc' ? 'ascending' : 'descending';
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={sortIndex === 0 ? sortLabel : undefined}
                      data-column-id={column.id}
                      data-column-kind={column.kind}
                      className="px-2 py-1 font-medium whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          executeAction('sortBy', {
                            column: column.id,
                            direction: nextDirection,
                            add: false,
                          })
                        }
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <span>{column.label}</span>
                        {sortRule && (
                          <>
                            <span aria-hidden="true">
                              {sortRule.direction === 'asc' ? '↑' : '↓'}
                            </span>
                            <span className="sr-only">
                              sorted {sortLabel}
                              {table.sort.length > 1
                                ? `, priority ${sortIndex + 1}`
                                : ''}
                            </span>
                          </>
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  {table.groupBy !== null && (
                    <tr
                      data-group={group.key}
                      className="border-b bg-black/5 font-mono text-xs text-ink-2"
                    >
                      <td
                        colSpan={Math.max(table.columns.length, 1)}
                        className="px-2 py-1"
                      >
                        {group.label} ({group.rows.length})
                      </td>
                    </tr>
                  )}
                  {group.rows.map((row) => (
                    <tr
                      key={row.task.id}
                      data-task-id={row.task.id}
                      className="border-b last:border-b-0"
                    >
                      {table.columns.map((column) => (
                        <TableCell
                          key={column.id}
                          taskId={row.task.id}
                          column={column}
                          display={row.cells[column.id]?.display ?? ''}
                          error={row.cells[column.id]?.error}
                          onEdit={(value) =>
                            executeAction('setCell', {
                              task: row.task.id,
                              column: column.id,
                              value,
                            })
                          }
                        />
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </TasklaneCard>
  );
}

function TableCell({
  taskId,
  column,
  display,
  error,
  onEdit,
}: {
  readonly taskId: string;
  readonly column: TableColumn;
  readonly display: string;
  readonly error?: string;
  readonly onEdit: (value: string) => void;
}) {
  if (column.kind === 'free') {
    return (
      <td
        data-column-id={column.id}
        data-column-kind="free"
        className="px-2 py-1"
      >
        <input
          type="text"
          aria-label={`${column.label} for ${taskId}`}
          value={display}
          onChange={(event) => onEdit(event.target.value)}
          className="w-full min-w-[6rem] rounded border bg-transparent px-1.5 py-0.5 text-sm"
        />
      </td>
    );
  }

  if (column.kind === 'field' && column.field === 'triageReason' && display) {
    const reasons = display.split(', ');
    return (
      <td
        data-column-id={column.id}
        data-column-kind="field"
        className="px-2 py-1"
      >
        <div className="flex flex-wrap gap-1">
          {reasons.map((reason) => (
            <span
              key={reason}
              data-reason={reason}
              className="tasklane-reason shrink-0 rounded px-1.5 font-mono text-xs"
            >
              {reason}
            </span>
          ))}
        </div>
      </td>
    );
  }

  return (
    <td
      data-column-id={column.id}
      data-column-kind={column.kind}
      title={error ?? column.formula}
      className="px-2 py-1 whitespace-nowrap"
    >
      {display}
    </td>
  );
}

function reportTableResult<T>(action: string, result: FlexibleTableResult<T>) {
  if (!result.ok) {
    const message = describeTableFailure(result);
    recordFailure(action, `Couldn't update the table: ${message}`);
    return err(new Error(message));
  }
  if (!result.changed) {
    recordUnchanged(action);
  }
  return ok(undefined);
}
