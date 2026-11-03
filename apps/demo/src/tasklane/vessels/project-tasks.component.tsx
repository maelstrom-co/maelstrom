import type { TypedVesselProps } from '@maelstrom-co/react';
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { VesselCard } from '../../components/vessel-card';
import { tasklaneM } from '../maelstrom';
import {
  descendantIds,
  NO_PARENT,
  orderedTaskRows,
  type ProjectTask,
  projectTaskActions,
  TASK_STATUS_NAMES,
  TASK_STATUSES,
  TASK_URGENCIES,
  useProjectTasksStore,
} from '../stores/project-tasks.store';
import { TEAM, UNASSIGNED } from '../stores/team';
import {
  reportCreateTask,
  reportPriorityChange,
  reportRemoveTask,
  reportTaskChange,
} from '../task-action-receipts';
import type { projectTasksVessel } from './project-tasks.vessel';

type ExecuteAction = TypedVesselProps<
  typeof projectTasksVessel
>['executeAction'];

interface TaskDraft {
  readonly taskId: string;
  readonly title: string;
  readonly description: string;
}

export default function ProjectTasksComponent({
  instanceId,
  executeAction,
}: TypedVesselProps<typeof projectTasksVessel>) {
  const { project, tasks, myPriorities } = useProjectTasksStore();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const focusAfterEdit = useRef<string | null>(null);
  const board = useRef<HTMLDivElement>(null);

  tasklaneM.useActions('project-tasks', instanceId, {
    createTask: async ({
      title,
      description,
      parent,
      assignee,
      urgency,
      source,
    }) =>
      reportCreateTask(
        projectTaskActions.createTask({
          title,
          description,
          parent,
          assignee,
          urgency,
          source,
        }),
      ),
    updateTask: async ({ task, title, description }) =>
      reportTaskChange(
        'updateTask',
        projectTaskActions.updateTask(task, { title, description }),
      ),
    setParent: async ({ task, parent }) =>
      reportTaskChange('setParent', projectTaskActions.setParent(task, parent)),
    assignTask: async ({ task, assignee }) =>
      reportTaskChange(
        'assignTask',
        projectTaskActions.assignTask(task, assignee),
      ),
    setUrgency: async ({ task, urgency }) =>
      reportTaskChange(
        'setUrgency',
        projectTaskActions.setUrgency(task, urgency),
      ),
    setStatus: async ({ task, status }) =>
      reportTaskChange('setStatus', projectTaskActions.setStatus(task, status)),
    addToMyPriorities: async ({ task, position }) =>
      reportPriorityChange(
        'addToMyPriorities',
        projectTaskActions.addToMyPriorities(task, position),
      ),
    removeFromMyPriorities: async ({ task }) =>
      reportPriorityChange(
        'removeFromMyPriorities',
        projectTaskActions.removeFromMyPriorities(task),
      ),
    removeTask: async ({ task }) =>
      reportRemoveTask(projectTaskActions.removeTask(task)),
  });

  useEffect(() => {
    if (draft !== null || !focusAfterEdit.current) return;
    const taskId = focusAfterEdit.current;
    focusAfterEdit.current = null;
    board.current
      ?.querySelector<HTMLButtonElement>(
        `[data-edit-task="${CSS.escape(taskId)}"]`,
      )
      ?.focus();
  }, [draft]);

  const closeEditor = () => {
    focusAfterEdit.current = draft?.taskId ?? null;
    setDraft(null);
  };

  const saveEditor = () => {
    if (!draft || draft.title.trim().length === 0) return;
    executeAction('updateTask', {
      task: draft.taskId,
      title: draft.title,
      description: draft.description,
    });
    closeEditor();
  };

  const rows = orderedTaskRows(tasks);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const prioritised = myPriorities.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });

  return (
    <VesselCard
      accent="amber"
      label="Tasks"
      meta={`${project} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
    >
      <div
        ref={board}
        className="tasklane-board flex-1 min-h-0 overflow-y-auto"
      >
        <section
          className="tasklane-priorities"
          aria-labelledby={`${instanceId}-priorities`}
        >
          <h3
            id={`${instanceId}-priorities`}
            className="tasklane-section-title"
          >
            My priorities
          </h3>
          {prioritised.length === 0 ? (
            <p className="text-xs text-ink-3">
              No tasks in your priorities yet.
            </p>
          ) : (
            <ol aria-label="My priorities" className="tasklane-priority-list">
              {prioritised.map((task, index) => (
                <li
                  key={task.id}
                  data-task-id={task.id}
                  className="tasklane-priority"
                >
                  <span className="tasklane-priority-rank">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {task.title}
                  </span>
                  <button
                    type="button"
                    className="tasklane-icon-button"
                    aria-label={`Move ${task.title} up`}
                    disabled={index === 0}
                    onClick={() =>
                      executeAction('addToMyPriorities', {
                        task: task.id,
                        position: index,
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="tasklane-icon-button"
                    aria-label={`Move ${task.title} down`}
                    disabled={index === prioritised.length - 1}
                    onClick={() =>
                      executeAction('addToMyPriorities', {
                        task: task.id,
                        position: index + 2,
                      })
                    }
                  >
                    ↓
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby={`${instanceId}-tasks`}>
          <h3 id={`${instanceId}-tasks`} className="tasklane-section-title">
            Project tasks
          </h3>
          {rows.length === 0 ? (
            <p className="text-xs text-ink-3">No tasks yet.</p>
          ) : (
            <ul aria-label="Project tasks" className="tasklane-task-list">
              {rows.map(({ task, depth }) => (
                <TaskRow
                  key={task.id}
                  instanceId={instanceId}
                  task={task}
                  depth={depth}
                  tasks={tasks}
                  inPriorities={myPriorities.includes(task.id)}
                  draft={draft?.taskId === task.id ? draft : null}
                  confirmingDelete={confirmingDelete === task.id}
                  executeAction={executeAction}
                  onEdit={() =>
                    setDraft({
                      taskId: task.id,
                      title: task.title,
                      description: task.description,
                    })
                  }
                  onDraftChange={setDraft}
                  onSave={saveEditor}
                  onCancel={closeEditor}
                  onConfirmDelete={(confirming) =>
                    setConfirmingDelete(confirming ? task.id : null)
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </VesselCard>
  );
}

interface TaskRowProps {
  readonly instanceId: string;
  readonly task: ProjectTask;
  readonly depth: number;
  readonly tasks: readonly ProjectTask[];
  readonly inPriorities: boolean;
  readonly draft: TaskDraft | null;
  readonly confirmingDelete: boolean;
  readonly executeAction: ExecuteAction;
  readonly onEdit: () => void;
  readonly onDraftChange: (draft: TaskDraft) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onConfirmDelete: (confirming: boolean) => void;
}

function TaskRow({
  instanceId,
  task,
  depth,
  tasks,
  inPriorities,
  draft,
  confirmingDelete,
  executeAction,
  onEdit,
  onDraftChange,
  onSave,
  onCancel,
  onConfirmDelete,
}: TaskRowProps) {
  const excluded = descendantIds(task.id, tasks);
  const parentChoices = tasks.filter(
    (candidate) => candidate.id !== task.id && !excluded.has(candidate.id),
  );
  const fieldId = `${instanceId}-${task.id}`;

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <li
      data-depth={depth}
      data-task-id={task.id}
      className="tasklane-task"
      style={{ '--tasklane-depth': depth } as CSSProperties}
    >
      {draft ? (
        <div className="tasklane-task-editor">
          <label htmlFor={`${fieldId}-title`} className="tasklane-field-label">
            Title
          </label>
          <input
            id={`${fieldId}-title`}
            className="tasklane-input"
            value={draft.title}
            onChange={(event) =>
              onDraftChange({ ...draft, title: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSave();
              } else handleEditorKeyDown(event);
            }}
          />
          <label
            htmlFor={`${fieldId}-description`}
            className="tasklane-field-label"
          >
            Description
          </label>
          <textarea
            id={`${fieldId}-description`}
            className="tasklane-textarea"
            rows={2}
            value={draft.description}
            onChange={(event) =>
              onDraftChange({ ...draft, description: event.target.value })
            }
            onKeyDown={handleEditorKeyDown}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="tasklane-button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="tasklane-button tasklane-button-primary"
              disabled={draft.title.trim().length === 0}
              onClick={onSave}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="tasklane-task-body">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-xs text-ink-3 shrink-0">
              {task.id}
            </span>
            <span className="tasklane-task-title">{task.title}</span>
          </div>
          {task.description ? (
            <p className="tasklane-task-description">{task.description}</p>
          ) : null}
        </div>
      )}

      <div className="tasklane-task-controls">
        <select
          className="tasklane-select"
          aria-label={`Status for ${task.title}`}
          value={task.status}
          onChange={(event) =>
            executeAction('setStatus', {
              task: task.id,
              status: event.target.value,
            })
          }
        >
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {TASK_STATUS_NAMES[status]}
            </option>
          ))}
        </select>
        <select
          className="tasklane-select"
          aria-label={`Assignee for ${task.title}`}
          value={task.assigneeId ?? UNASSIGNED}
          onChange={(event) =>
            executeAction('assignTask', {
              task: task.id,
              assignee: event.target.value,
            })
          }
        >
          {TEAM.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
          <option value={UNASSIGNED}>Unassigned</option>
        </select>
        <select
          className="tasklane-select"
          aria-label={`Urgency for ${task.title}`}
          value={task.urgency}
          onChange={(event) =>
            executeAction('setUrgency', {
              task: task.id,
              urgency: event.target.value,
            })
          }
        >
          {TASK_URGENCIES.map((urgency) => (
            <option key={urgency} value={urgency}>
              {urgency}
            </option>
          ))}
        </select>
        <select
          className="tasklane-select"
          aria-label={`Parent of ${task.title}`}
          value={task.parentId ?? NO_PARENT}
          onChange={(event) =>
            executeAction('setParent', {
              task: task.id,
              parent: event.target.value,
            })
          }
        >
          <option value={NO_PARENT}>No parent</option>
          {parentChoices.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              Under {candidate.id} {candidate.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="tasklane-button"
          aria-label={
            inPriorities
              ? `Remove ${task.title} from my priorities`
              : `Add ${task.title} to my priorities`
          }
          onClick={() =>
            inPriorities
              ? executeAction('removeFromMyPriorities', { task: task.id })
              : executeAction('addToMyPriorities', { task: task.id })
          }
        >
          {inPriorities ? 'Remove from my priorities' : 'Add to my priorities'}
        </button>
        {draft ? null : (
          <button
            type="button"
            className="tasklane-button"
            aria-label={`Edit ${task.title}`}
            data-edit-task={task.id}
            onClick={onEdit}
          >
            Edit
          </button>
        )}
        {confirmingDelete ? (
          <>
            <button
              type="button"
              className="tasklane-button tasklane-button-danger"
              aria-label={`Confirm delete ${task.title}`}
              onClick={() => {
                onConfirmDelete(false);
                executeAction('removeTask', { task: task.id });
              }}
            >
              Confirm delete
            </button>
            <button
              type="button"
              className="tasklane-button"
              onClick={() => onConfirmDelete(false)}
            >
              Keep task
            </button>
          </>
        ) : (
          <button
            type="button"
            className="tasklane-button"
            aria-label={`Delete ${task.title}`}
            onClick={() => onConfirmDelete(true)}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
