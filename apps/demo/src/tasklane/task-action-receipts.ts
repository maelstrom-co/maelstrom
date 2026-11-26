import { err, ok } from '@maelstrom-co/protocol';

import { type BoardFilterResult, EVERYONE } from './stores/board-filter.store';
import type { FeedbackMutationResult } from './stores/feedback.store';
import {
  assigneeLabel,
  type CreateTaskResult,
  describeTaskFailure,
  getProjectTasksSnapshot,
  type PriorityChange,
  type ProjectTask,
  type RemoveTaskResult,
  type TaskChange,
  type TaskFailure,
  taskSummary,
} from './stores/project-tasks.store';
import type { OpenTaskDetailResult } from './stores/task-detail.store';
import { describeTeamMembers } from './stores/team';
import { type ChangeDescription, describeChange } from './tasklane-activity';

type TaskChangeAction =
  | 'updateTask'
  | 'setParent'
  | 'assignTask'
  | 'setUrgency'
  | 'setStatus'
  | 'setDueDate';
type PriorityAction = 'addToMyPriorities' | 'removeFromMyPriorities';

const VERBS: Readonly<Record<string, string>> = {
  createTask: 'create',
  updateTask: 'update',
  setParent: 'move',
  assignTask: 'assign',
  setUrgency: 'change the urgency of',
  setStatus: 'change the status of',
  setDueDate: 'set the due date of',
  addToMyPriorities: 'add to your priorities',
  removeFromMyPriorities: 'remove from your priorities',
  removeTask: 'delete',
  showTask: 'open',
};

/**
 * Each report returns the Action result. A change returns its receipt note.
 * A failure's message starts with a short reason for the person, then gives
 * the Planner a message naming valid choices on the following lines.
 */
export function reportCreateTask(result: CreateTaskResult) {
  if (!result.ok) return fail('createTask', result);
  return changed({ kind: 'created', subject: result.task.title });
}

export function reportTaskChange(action: TaskChangeAction, result: TaskChange) {
  if (!result.ok) return fail(action, result);
  if (!result.changed) return ok(undefined);
  return changed(describeTaskChange(action, result.previous, result.task));
}

export function reportPriorityChange(
  action: PriorityAction,
  result: PriorityChange,
) {
  if (!result.ok) return fail(action, result);
  if (!result.changed) return ok(undefined);
  const subject = result.task.title;
  if (action === 'removeFromMyPriorities')
    return changed({ kind: 'deprioritised', subject });
  if (result.previousPosition === null)
    return changed({ kind: 'prioritised', subject });
  return changed({
    kind: 'reprioritised',
    subject,
    detail: String(result.position),
  });
}

export function reportRemoveTask(result: RemoveTaskResult) {
  if (!result.ok) return fail('removeTask', result);
  return changed({ kind: 'removed', subject: result.task.title });
}

/** Opening a task changes no data, so only a failure reaches the receipt line. */
export function reportShowTask(result: OpenTaskDetailResult) {
  if (!result.ok) return fail('showTask', result);
  return ok(undefined);
}

/** Filtering changes no data, so only a failure reaches the receipt line. */
export function reportBoardFilter(result: BoardFilterResult) {
  if (result.ok) return ok(undefined);
  return failWith(
    `Couldn't find a team member called "${result.query}"`,
    `No team member matches "${result.query}". Use ${describeTeamMembers()}, or ${EVERYONE} to clear the filter.`,
  );
}

export function reportReplaceFeedback(result: FeedbackMutationResult) {
  if (!result.ok)
    return failWith(
      "Couldn't replace the feedback with empty text",
      'Feedback text cannot be empty.',
    );
  if (!result.changed) return ok(undefined);
  return changed({
    kind: 'feedback',
    subject: 'feedback',
    detail: result.truncated ? 'truncated' : null,
  });
}

/** A short reason for the receipt line, starting with "Couldn't". */
export function failureReceipt(action: string, failure: TaskFailure): string {
  const verb = VERBS[action] ?? 'change';
  switch (failure.reason) {
    case 'empty_title':
      return "Couldn't save a task without a title";
    case 'task_not_found':
      return `Couldn't find a task matching "${failure.query}"`;
    case 'parent_not_found':
      return `Couldn't find a parent task matching "${failure.query}"`;
    case 'ambiguous_task':
    case 'ambiguous_parent':
      return `Couldn't tell which task "${failure.query}" means`;
    case 'stale_reference':
      return failure.role === 'parent'
        ? `Couldn't use "${failure.task.title}" as the parent because it changed: now ${taskSummary(failure.task)}`
        : `Couldn't ${verb} "${failure.task.title}" because it changed: now ${taskSummary(failure.task)}`;
    case 'cycle':
      return failure.task.id === failure.parent.id
        ? `Couldn't move "${failure.task.title}" under itself`
        : `Couldn't move "${failure.task.title}" under "${failure.parent.title}", which is inside it`;
    case 'unknown_assignee':
      return `Couldn't find a team member called "${failure.query}"`;
    case 'unknown_urgency':
      return `Couldn't set the urgency to "${failure.query}"`;
    case 'unknown_status':
      return `Couldn't set the status to "${failure.query}"`;
    case 'invalid_due_date':
      return `Couldn't set the due date to "${failure.query}"`;
    case 'bad_position':
      return `Couldn't use priority position ${failure.position}`;
    case 'not_in_priorities':
      return `Couldn't remove "${failure.task.title}" from your priorities because it isn't in them`;
  }
}

function fail(action: string, failure: TaskFailure) {
  return failWith(
    failureReceipt(action, failure),
    describeTaskFailure(failure),
  );
}

function failWith(receipt: string, guidance: string) {
  return err(new Error(`${receipt}\n${guidance}`));
}

function changed(change: ChangeDescription) {
  return ok(describeChange(change));
}

function describeTaskChange(
  action: TaskChangeAction,
  previous: ProjectTask,
  task: ProjectTask,
): ChangeDescription {
  const subject = task.title;
  switch (action) {
    case 'updateTask': {
      const renamed = previous.title !== task.title;
      const described = previous.description !== task.description;
      if (renamed && described) return { kind: 'edited', subject };
      return renamed
        ? { kind: 'renamed', subject: previous.title }
        : { kind: 'described', subject };
    }
    case 'setParent': {
      const parent = task.parentId
        ? getProjectTasksSnapshot().tasks.find(
            (candidate) => candidate.id === task.parentId,
          )
        : undefined;
      return {
        kind: 'moved',
        subject,
        detail: parent?.title ?? null,
      };
    }
    case 'assignTask':
      if (task.assigneeId === null) return { kind: 'unassigned', subject };
      return {
        kind: previous.assigneeId === null ? 'assigned' : 'reassigned',
        subject,
        detail: assigneeLabel(task.assigneeId),
      };
    case 'setUrgency':
      return { kind: 'urgency', subject, detail: task.urgency };
    case 'setStatus':
      return { kind: 'status', subject, detail: task.status };
    case 'setDueDate':
      return { kind: 'dueDate', subject, detail: task.dueDate };
  }
}
