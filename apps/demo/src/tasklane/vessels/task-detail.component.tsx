import type { TypedVesselProps } from '@maelstrom-co/react';
import { VesselCard } from '../../components/vessel-card';
import { tasklaneM } from '../maelstrom';
import {
  assigneeLabel,
  type ProjectTask,
  priorityLabel,
  TASK_STATUS_NAMES,
  useProjectTasksStore,
} from '../stores/project-tasks.store';
import { openTaskDetail, useSelectedTaskId } from '../stores/task-detail.store';
import { reportShowTask } from '../task-action-receipts';
import type { taskDetailVessel } from './task-detail.vessel';

type ExecuteAction = TypedVesselProps<typeof taskDetailVessel>['executeAction'];

export default function TaskDetailComponent({
  instanceId,
  executeAction,
}: TypedVesselProps<typeof taskDetailVessel>) {
  const { tasks, myPriorities } = useProjectTasksStore();
  const selectedId = useSelectedTaskId(instanceId);

  tasklaneM.useActions('task-detail', instanceId, {
    showTask: async ({ task }) =>
      reportShowTask(openTaskDetail(instanceId, task)),
  });

  const task = selectedId
    ? tasks.find((candidate) => candidate.id === selectedId)
    : undefined;

  if (!task) {
    return (
      <VesselCard accent="brand-3" label="Task">
        <p className="text-sm text-ink-3">
          {selectedId
            ? `${selectedId} was deleted. Ask Tasklane to open another task.`
            : 'No task open yet. Ask Tasklane to open one, for example "open TL-2".'}
        </p>
      </VesselCard>
    );
  }

  const parent = task.parentId
    ? tasks.find((candidate) => candidate.id === task.parentId)
    : undefined;
  const subtasks = tasks.filter((candidate) => candidate.parentId === task.id);

  return (
    <VesselCard
      accent="brand-3"
      label="Task"
      meta={`${task.id} · ${priorityLabel(task.id, myPriorities)}`}
    >
      <article
        aria-label={`${task.id} ${task.title}`}
        className="tasklane-detail flex-1 min-h-0 overflow-y-auto"
      >
        <h3 className="tasklane-detail-title">{task.title}</h3>
        <dl className="tasklane-detail-fields">
          <dt>Owner</dt>
          <dd>{assigneeLabel(task.assigneeId)}</dd>
          <dt>Urgency</dt>
          <dd>{task.urgency}</dd>
          <dt>Status</dt>
          <dd>{TASK_STATUS_NAMES[task.status]}</dd>
          <dt>Parent</dt>
          <dd>
            {parent ? (
              <TaskLink task={parent} executeAction={executeAction} />
            ) : (
              'Top level'
            )}
          </dd>
        </dl>
        <section>
          <h4 className="tasklane-section-title">Description</h4>
          <p className="tasklane-task-description">
            {task.description || 'No description yet.'}
          </p>
        </section>
        {task.sourceFeedback ? (
          <section>
            <h4 className="tasklane-section-title">From the feedback</h4>
            <blockquote className="tasklane-detail-quote">
              {task.sourceFeedback}
            </blockquote>
          </section>
        ) : null}
        <section>
          <h4 className="tasklane-section-title">Subtasks</h4>
          {subtasks.length === 0 ? (
            <p className="text-xs text-ink-3">No subtasks.</p>
          ) : (
            <ul aria-label="Subtasks" className="tasklane-task-list">
              {subtasks.map((subtask) => (
                <li key={subtask.id}>
                  <TaskLink task={subtask} executeAction={executeAction} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </article>
    </VesselCard>
  );
}

function TaskLink({
  task,
  executeAction,
}: {
  readonly task: ProjectTask;
  readonly executeAction: ExecuteAction;
}) {
  return (
    <button
      type="button"
      className="tasklane-detail-link"
      aria-label={`Open ${task.id} ${task.title}`}
      onClick={() => executeAction('showTask', { task: task.id })}
    >
      <span className="font-mono text-xs text-ink-3">{task.id}</span>{' '}
      {task.title}
    </button>
  );
}
