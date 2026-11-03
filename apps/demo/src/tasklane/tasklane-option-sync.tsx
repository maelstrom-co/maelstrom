import type { VesselDefinition } from '@maelstrom-co/protocol';
import { useEffect } from 'react';
import { withActionOptions } from '../lib/vessel-options';
import { tasklaneM } from './maelstrom';
import {
  cleanOptionValues,
  optionKey,
  republishWithRetry,
} from './option-publishing';
import { type FeedbackState, useFeedbackStore } from './stores/feedback.store';
import {
  assigneeLabel,
  type ProjectTask,
  type ProjectTasksState,
  priorityLabel,
  taskReferenceLabel,
  useProjectTasksStore,
} from './stores/project-tasks.store';
import { myPrioritiesVessel } from './vessels/my-priorities.vessel.def';
import { projectTasksVessel } from './vessels/project-tasks.vessel.def';
import { sourceFeedbackVessel } from './vessels/source-feedback.vessel.def';
import { taskDetailVessel } from './vessels/task-detail.vessel.def';

export const TASK_SUMMARY_CHARACTER_LIMIT = 1500;
export const TASK_SUMMARY_HEADING =
  '\n\nCurrent task records, kept up to date after every change:\n';
export const MY_PRIORITIES_HEADING =
  '\n\nCurrent priorities, top first, kept up to date after every change:\n';
export const FEEDBACK_DESCRIPTION_HEADING =
  '\n\nCurrent feedback snapshot, the text "this feedback" refers to:\n';

const TASK_PARAMETER_ACTIONS = [
  'updateTask',
  'setParent',
  'assignTask',
  'setUrgency',
  'setStatus',
  'addToMyPriorities',
  'removeFromMyPriorities',
  'removeTask',
] as const;
const PRIORITY_PARAMETER_ACTIONS = [
  'addToMyPriorities',
  'removeFromMyPriorities',
] as const;
const SUMMARY_DESCRIPTION_LIMIT = 60;

/**
 * The Tasks definition as the Planner should see it now. The Planner sees no
 * Instance data, so the current records travel in the definition: each task
 * parameter offers the live references, and the description carries a
 * bounded summary of hierarchy, assignees, urgency, status and priorities.
 */
export function projectTasksDefinition(
  state: ProjectTasksState,
): typeof projectTasksVessel {
  const references = taskReferences(state, 'project-tasks');
  const withReferences = withActionOptions(
    projectTasksVessel,
    Object.fromEntries(
      TASK_PARAMETER_ACTIONS.map((action) => [action, { task: references }]),
    ),
  );
  return {
    ...withReferences,
    description: `${projectTasksVessel.description}${taskSummary(state)}`,
  };
}

/** The My priorities definition with the live task references and the ordered list. */
export function myPrioritiesDefinition(
  state: ProjectTasksState,
): typeof myPrioritiesVessel {
  const references = taskReferences(state, 'my-priorities');
  const withReferences = withActionOptions(
    myPrioritiesVessel,
    Object.fromEntries(
      PRIORITY_PARAMETER_ACTIONS.map((action) => [
        action,
        { task: references },
      ]),
    ),
  );
  return {
    ...withReferences,
    description: `${myPrioritiesVessel.description}${MY_PRIORITIES_HEADING}${prioritySummary(state)}`,
  };
}

/** The Task detail definition with the live task references on showTask. */
export function taskDetailDefinition(
  state: ProjectTasksState,
): typeof taskDetailVessel {
  return withActionOptions(taskDetailVessel, {
    showTask: { task: taskReferences(state, 'task-detail') },
  });
}

/** The Feedback definition with the current snapshot, which the Planner cannot read from the page. */
export function sourceFeedbackDefinition(
  state: FeedbackState,
): typeof sourceFeedbackVessel {
  return {
    ...sourceFeedbackVessel,
    description: `${sourceFeedbackVessel.description}${FEEDBACK_DESCRIPTION_HEADING}${state.text}`,
  };
}

/** Renders nothing. Republishes every Tasklane definition whenever the records change. */
export function TasklaneOptionSync() {
  const tasksState = useProjectTasksStore();
  const feedbackState = useFeedbackStore();
  const isProcessing = tasklaneM.useMaelstrom((state) => state.isProcessing);

  const tasksDefinition = projectTasksDefinition(tasksState);
  const prioritiesDefinition = myPrioritiesDefinition(tasksState);
  const detailDefinition = taskDetailDefinition(tasksState);
  const feedbackDefinition = sourceFeedbackDefinition(feedbackState);
  const tasksKey = optionKey([
    tasksDefinition.description,
    ...TASK_PARAMETER_ACTIONS.map((action) =>
      JSON.stringify(taskEnum(tasksDefinition, action)),
    ),
  ]);
  const prioritiesKey = optionKey([
    prioritiesDefinition.description,
    ...PRIORITY_PARAMETER_ACTIONS.map((action) =>
      JSON.stringify(taskEnum(prioritiesDefinition, action)),
    ),
  ]);
  const detailKey = optionKey([
    JSON.stringify(taskEnum(detailDefinition, 'showTask')),
  ]);
  const feedbackKey = optionKey([feedbackDefinition.description]);

  useEffect(
    () => republishWithRetry(() => tasklaneM.updateVessel(tasksDefinition)),
    [tasksKey, isProcessing],
  );
  useEffect(
    () =>
      republishWithRetry(() => tasklaneM.updateVessel(prioritiesDefinition)),
    [prioritiesKey, isProcessing],
  );
  useEffect(
    () => republishWithRetry(() => tasklaneM.updateVessel(detailDefinition)),
    [detailKey, isProcessing],
  );
  useEffect(
    () => republishWithRetry(() => tasklaneM.updateVessel(feedbackDefinition)),
    [feedbackKey, isProcessing],
  );

  return null;
}

function taskReferences(state: ProjectTasksState, label: string): string[] {
  return cleanOptionValues(
    state.tasks.map((task) => taskReferenceLabel(task, state.myPriorities)),
    label,
  );
}

function prioritySummary(state: ProjectTasksState): string {
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  const lines = state.myPriorities.flatMap((id, index) => {
    const task = byId.get(id);
    return task ? [`#${index + 1} ${task.id} "${shorten(task.title)}"`] : [];
  });
  if (lines.length === 0) return 'None yet.';
  let summary = '';
  for (const [index, line] of lines.entries()) {
    const remaining = lines.length - index;
    if (summary.length + line.length > TASK_SUMMARY_CHARACTER_LIMIT)
      return `${summary}and ${remaining} more.`;
    summary += `${line}\n`;
  }
  return summary.trimEnd();
}

function taskSummary(state: ProjectTasksState): string {
  if (state.tasks.length === 0) return `${TASK_SUMMARY_HEADING}No tasks yet.`;
  let summary = TASK_SUMMARY_HEADING;
  for (const [index, task] of state.tasks.entries()) {
    const line = `${summaryLine(task, state.myPriorities)}\n`;
    const remaining = state.tasks.length - index;
    const overflow = `and ${remaining} more tasks.`;
    if (
      summary.length + line.length + overflow.length >
        TASK_SUMMARY_CHARACTER_LIMIT &&
      remaining > 0
    ) {
      return `${summary}${overflow}`;
    }
    summary += line;
  }
  return summary.trimEnd();
}

function summaryLine(task: ProjectTask, priorities: readonly string[]): string {
  const parent = task.parentId ? `parent ${task.parentId}` : 'top level';
  const assignee = task.assigneeId
    ? `assignee ${assigneeLabel(task.assigneeId)}`
    : 'unassigned';
  const description = task.description
    ? `, description "${shorten(task.description)}"`
    : ', no description';
  const source = task.sourceFeedback
    ? `, from feedback "${shorten(task.sourceFeedback)}"`
    : '';
  return `${task.id} "${shorten(task.title)}": ${parent}, ${assignee}, urgency ${task.urgency}, status ${task.status}, ${priorityLabel(task.id, priorities)}${description}${source}`;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_DESCRIPTION_LIMIT
    ? `${flat.slice(0, SUMMARY_DESCRIPTION_LIMIT).trimEnd()}...`
    : flat;
}

function taskEnum(
  vessel: VesselDefinition,
  action: string,
): readonly unknown[] | undefined {
  for (const variant of Object.values(vessel.variants)) {
    const found = variant.actions
      .find((candidate) => candidate.name === action)
      ?.parameters?.find((parameter) => parameter.name === 'task');
    if (found) return found.enum;
  }
  return undefined;
}
