import { err, ok } from '@maelstrom-co/protocol';
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
import {
  type ChangeDescription,
  recordChange,
  recordFailure,
  recordUnchanged,
} from './tasklane-activity';

type TaskChangeAction =
  | 'updateTask'
  | 'setParent'
  | 'assignTask'
  | 'setUrgency'
  | 'setStatus';
type PriorityAction = 'addToMyPriorities' | 'removeFromMyPriorities';

const VERBS: Readonly<Record<string, string>> = {
  createTask: 'create',
  updateTask: 'update',
  setParent: 'move',
  assignTask: 'assign',
  setUrgency: 'change the urgency of',
  setStatus: 'change the status of',
  addToMyPriorities: 'add to your priorities',
  removeFromMyPriorities: 'remove from your priorities',
  removeTask: 'delete',
  showTask: 'open',
};

/**
 * Each report records what really happened in the activity log and returns
 * the Action result: the Planner gets a message naming valid choices, the
 * receipt gets a short reason for the person.
 */
export function reportCreateTask(result: CreateTaskResult) {
  if (!result.ok) return fail('createTask', result);
  recordChange('createTask', {
    kind: 'created',
    subject: result.task.title,
    subjectId: result.task.id,
  });
  return ok(undefined);
}

export function reportTaskChange(action: TaskChangeAction, result: TaskChange) {
  if (!result.ok) return fail(action, result);
  if (!result.changed) {
    recordUnchanged(action);
    return ok(undefined);
  }
  recordChange(
    action,
    describeTaskChange(action, result.previous, result.task),
  );
  return ok(undefined);
}

export function reportPriorityChange(
  action: PriorityAction,
  result: PriorityChange,
) {
  if (!result.ok) return fail(action, result);
  if (!result.changed) {
    recordUnchanged(action);
    return ok(undefined);
  }
  const subject = result.task.title;
  const subjectId = result.task.id;
  if (action === 'removeFromMyPriorities') {
    recordChange(action, { kind: 'deprioritised', subject, subjectId });
  } else if (result.previousPosition === null) {
    recordChange(action, { kind: 'prioritised', subject, subjectId });
  } else {
    recordChange(action, {
      kind: 'reprioritised',
      subject,
      subjectId,
      detail: String(result.position),
    });
  }
  return ok(undefined);
}

export function reportRemoveTask(result: RemoveTaskResult) {
  if (!result.ok) return fail('removeTask', result);
  recordChange('removeTask', {
    kind: 'removed',
    subject: result.task.title,
    subjectId: result.task.id,
  });
  return ok(undefined);
}

/** Opening a task changes no data, so only a failure reaches the receipt line. */
export function reportShowTask(result: OpenTaskDetailResult) {
  if (!result.ok) return fail('showTask', result);
  return ok(undefined);
}

export function reportReplaceFeedback(result: FeedbackMutationResult) {
  if (!result.ok) {
    recordFailure(
      'replaceFeedback',
      "Couldn't replace the feedback with empty text",
    );
    return err(new Error('Feedback text cannot be empty.'));
  }
  if (!result.changed) {
    recordUnchanged('replaceFeedback');
    return ok(undefined);
  }
  recordChange('replaceFeedback', {
    kind: 'feedback',
    subject: 'feedback',
    subjectId: 'feedback',
    detail: result.truncated ? 'truncated' : null,
  });
  return ok(undefined);
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
    case 'bad_position':
      return `Couldn't use priority position ${failure.position}`;
    case 'not_in_priorities':
      return `Couldn't remove "${failure.task.title}" from your priorities because it isn't in them`;
  }
}

function fail(action: string, failure: TaskFailure) {
  recordFailure(action, failureReceipt(action, failure));
  return err(new Error(describeTaskFailure(failure)));
}

function describeTaskChange(
  action: TaskChangeAction,
  previous: ProjectTask,
  task: ProjectTask,
): ChangeDescription {
  const subject = task.title;
  const subjectId = task.id;
  switch (action) {
    case 'updateTask': {
      const renamed = previous.title !== task.title;
      const described = previous.description !== task.description;
      if (renamed && described) return { kind: 'edited', subject, subjectId };
      return renamed
        ? { kind: 'renamed', subject: previous.title, subjectId }
        : { kind: 'described', subject, subjectId };
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
        subjectId,
        detail: parent?.title ?? null,
      };
    }
    case 'assignTask':
      if (task.assigneeId === null)
        return { kind: 'unassigned', subject, subjectId };
      return {
        kind: previous.assigneeId === null ? 'assigned' : 'reassigned',
        subject,
        subjectId,
        detail: assigneeLabel(task.assigneeId),
      };
    case 'setUrgency':
      return { kind: 'urgency', subject, subjectId, detail: task.urgency };
    case 'setStatus':
      return { kind: 'status', subject, subjectId, detail: task.status };
  }
}
