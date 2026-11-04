import type { VesselDefinition } from '@maelstrom-co/protocol';
import type { UpdateVesselResult } from '@maelstrom-co/react';
import { useEffect } from 'react';
import { withActionOptions } from '../lib/vessel-options';
import { tasklaneM } from './maelstrom';
import {
  cleanOptionValues,
  optionKey,
  republishWithRetry,
} from './option-publishing';
import {
  type BoardFilterState,
  getBoardFilterSnapshot,
  useBoardFilterStore,
} from './stores/board-filter.store';
import { type FeedbackState, useFeedbackStore } from './stores/feedback.store';
import {
  assigneeLabel,
  type ProjectTask,
  type ProjectTasksState,
  prioritisedTasks,
  priorityLabel,
  taskReferenceLabel,
  useProjectTasksStore,
} from './stores/project-tasks.store';
import { myPrioritiesVessel } from './vessels/my-priorities.vessel.def';
import { projectTasksVessel } from './vessels/project-tasks.vessel.def';
import { sourceFeedbackVessel } from './vessels/source-feedback.vessel.def';
import { taskDetailVessel } from './vessels/task-detail.vessel.def';
import { triageInboxVessel } from './vessels/triage-inbox.vessel.def';

export const TASK_SUMMARY_CHARACTER_LIMIT = 1500;
export const TASK_SUMMARY_HEADING =
  '\n\nCurrent task records, kept up to date after every change:\n';
export const BOARD_FILTER_HEADING = '\n\nBoard filter: ';
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
 * bounded summary of hierarchy, assignees, urgency, status and priorities,
 * after a note of whose tasks the board shows.
 */
export function projectTasksDefinition(
  state: ProjectTasksState,
  filter: BoardFilterState = getBoardFilterSnapshot(),
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
    description: `${projectTasksVessel.description}${BOARD_FILTER_HEADING}${filterNote(filter)}${taskSummary(state)}`,
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

/** The Triage inbox definition with the live task references on assignTask. */
export function triageInboxDefinition(
  state: ProjectTasksState,
): typeof triageInboxVessel {
  return withActionOptions(triageInboxVessel, {
    assignTask: { task: taskReferences(state, 'triage-inbox') },
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
  const filterState = useBoardFilterStore();
  const isProcessing = tasklaneM.useMaelstrom((state) => state.isProcessing);

  const tasks = projectTasksDefinition(tasksState, filterState);
  const priorities = myPrioritiesDefinition(tasksState);
  const detail = taskDetailDefinition(tasksState);
  const triage = triageInboxDefinition(tasksState);
  const feedback = sourceFeedbackDefinition(feedbackState);

  useRepublish(tasks, () => tasklaneM.updateVessel(tasks), isProcessing, {
    description: true,
    taskActions: TASK_PARAMETER_ACTIONS,
  });
  useRepublish(
    priorities,
    () => tasklaneM.updateVessel(priorities),
    isProcessing,
    { description: true, taskActions: PRIORITY_PARAMETER_ACTIONS },
  );
  useRepublish(detail, () => tasklaneM.updateVessel(detail), isProcessing, {
    description: false,
    taskActions: ['showTask'],
  });
  useRepublish(triage, () => tasklaneM.updateVessel(triage), isProcessing, {
    description: false,
    taskActions: ['assignTask'],
  });
  useRepublish(feedback, () => tasklaneM.updateVessel(feedback), isProcessing, {
    description: true,
    taskActions: [],
  });

  return null;
}

interface RepublishKey {
  /** Whether a change to the description alone republishes the definition. */
  readonly description: boolean;
  /** The Actions whose task references republish the definition when they change. */
  readonly taskActions: readonly string[];
}

// Republishes only when the parts the Planner reads change, or when a batch
// settles, so an unrelated store update never resends an identical definition.
// The caller passes the publish call because updateVessel needs each
// definition's own literal type.
function useRepublish(
  definition: VesselDefinition,
  publish: () => UpdateVesselResult,
  isProcessing: boolean,
  key: RepublishKey,
): void {
  const republishKey = optionKey([
    ...(key.description ? [definition.description] : []),
    ...key.taskActions.map((action) =>
      JSON.stringify(taskEnum(definition, action)),
    ),
  ]);
  useEffect(() => republishWithRetry(publish), [republishKey, isProcessing]);
}

function filterNote(filter: BoardFilterState): string {
  if (filter.assigneeFilter === null)
    return "The board shows everyone's tasks.";
  return `The board shows only ${assigneeLabel(filter.assigneeFilter)}'s tasks. Run filterByAssignee with everyone to show all tasks again.`;
}

function taskReferences(state: ProjectTasksState, label: string): string[] {
  return cleanOptionValues(
    state.tasks.map((task) => taskReferenceLabel(task, state.myPriorities)),
    label,
  );
}

function prioritySummary(state: ProjectTasksState): string {
  const lines = prioritisedTasks(state).map(
    (task, index) => `#${index + 1} ${task.id} "${shorten(task.title)}"`,
  );
  if (lines.length === 0) return 'None yet.';
  return boundedLines('', lines, (remaining) => `and ${remaining} more.`);
}

function taskSummary(state: ProjectTasksState): string {
  if (state.tasks.length === 0) return `${TASK_SUMMARY_HEADING}No tasks yet.`;
  return boundedLines(
    TASK_SUMMARY_HEADING,
    state.tasks.map((task) => summaryLine(task, state.myPriorities)),
    (remaining) => `and ${remaining} more tasks.`,
  );
}

// Reserves room for the overflow sentence before each line, so the result
// never passes the limit even when the cut lands on the last line that fits.
function boundedLines(
  heading: string,
  lines: readonly string[],
  overflow: (remaining: number) => string,
): string {
  let summary = heading;
  for (const [index, line] of lines.entries()) {
    const more = overflow(lines.length - index);
    if (
      summary.length + line.length + 1 + more.length >
      TASK_SUMMARY_CHARACTER_LIMIT
    )
      return `${summary}${more}`;
    summary += `${line}\n`;
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
