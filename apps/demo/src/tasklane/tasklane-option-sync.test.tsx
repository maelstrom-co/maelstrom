// @vitest-environment happy-dom

import {
  MAX_CAPABILITY_OPTION_COUNT,
  MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
} from '@maelstrom-co/client';
import {
  MAX_ACTION_PARAMETER_ENUM_CANDIDATES,
  type VesselDefinition,
} from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sync = vi.hoisted(() => ({
  isProcessing: false,
  results: {} as Record<
    string,
    { ok: boolean; conflict?: Record<string, string> }[]
  >,
  published: [] as VesselDefinition[],
}));

vi.mock('./maelstrom', () => ({
  tasklaneM: {
    useMaelstrom: (selector: (state: { isProcessing: boolean }) => unknown) =>
      selector({ isProcessing: sync.isProcessing }),
    updateVessel: (vessel: VesselDefinition) => {
      sync.published.push(vessel);
      return sync.results[vessel.id]?.shift() ?? { ok: true };
    },
  },
}));

const {
  FEEDBACK_DESCRIPTION_HEADING,
  projectTasksDefinition,
  sourceFeedbackDefinition,
  TASK_SUMMARY_CHARACTER_LIMIT,
  TASK_SUMMARY_HEADING,
  TasklaneOptionSync,
} = await import('./tasklane-option-sync');
const { cleanOptionValues } = await import('./option-publishing');
const {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
  projectTaskActions,
} = await import('./stores/project-tasks.store');
const {
  __resetFeedbackStoreForTests,
  FEEDBACK_CHARACTER_LIMIT,
  feedbackActions,
  getFeedbackSnapshot,
} = await import('./stores/feedback.store');
const { projectTasksVessel } = await import(
  './vessels/project-tasks.vessel.def'
);
const { sourceFeedbackVessel } = await import(
  './vessels/source-feedback.vessel.def'
);

const TASK_PARAMETER_ACTIONS = [
  'updateTask',
  'setParent',
  'assignTask',
  'setUrgency',
  'setStatus',
  'addToMyPriorities',
  'removeFromMyPriorities',
  'removeTask',
];

beforeEach(() => {
  sync.isProcessing = false;
  sync.results = {};
  sync.published = [];
  __resetProjectTasksStoreForTests();
  __resetFeedbackStoreForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('projectTasksDefinition', () => {
  it('publishes every task as an id, title and status label on each task parameter', () => {
    projectTaskActions.addToMyPriorities('TL-2');
    const definition = projectTasksDefinition(getProjectTasksSnapshot());
    for (const action of TASK_PARAMETER_ACTIONS) {
      expect(taskEnum(definition, action), action).toEqual([
        'TL-1 Update demo README (Alex, normal, not in priorities)',
        'TL-2 Record launch video (Sam, normal, priority #1)',
      ]);
    }
    expect(parameter(definition, 'createTask', 'parent')?.enum).toBeUndefined();
    expect(parameter(definition, 'setParent', 'parent')?.enum).toBeUndefined();
  });

  it('cleans pipes, newlines and control characters out of user titles', () => {
    projectTaskActions.createTask({ title: 'Fix a | b\nnext line\tend' });
    const labels = taskEnum(
      projectTasksDefinition(getProjectTasksSnapshot()),
      'assignTask',
    );
    expect(labels).toContain(
      'TL-3 Fix a b next line end (unassigned, normal, not in priorities)',
    );
    for (const label of labels ?? []) {
      expect(label).not.toMatch(/[|\r\n\t]/);
    }
  });

  it('stays under the option count and character caps', () => {
    for (let i = 0; i < 130; i++) {
      projectTaskActions.createTask({ title: `Generated task number ${i}` });
    }
    const labels = taskEnum(
      projectTasksDefinition(getProjectTasksSnapshot()),
      'removeTask',
    );
    expect(labels?.length).toBeGreaterThan(0);
    expect(labels?.length).toBeLessThanOrEqual(MAX_CAPABILITY_OPTION_COUNT);
    expect(
      (labels ?? []).reduce((sum, label) => sum + label.length, 0),
    ).toBeLessThanOrEqual(MAX_CAPABILITY_OPTIONS_TOTAL_CHARS);
    expect(labels?.[0]).toMatch(/^TL-1 /);
  });

  it('keeps short labels within the enum candidate limit the Vessel schema accepts', () => {
    const values = Array.from(
      { length: MAX_ACTION_PARAMETER_ENUM_CANDIDATES + 1 },
      (_, i) => `TL-${i + 1}`,
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(cleanOptionValues(values, 'tasks')).toEqual(
      values.slice(0, MAX_ACTION_PARAMETER_ENUM_CANDIDATES),
    );
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('publishes no enum when there are no tasks', () => {
    projectTaskActions.removeTask('TL-1');
    projectTaskActions.removeTask('TL-2');
    expect(
      taskEnum(projectTasksDefinition(getProjectTasksSnapshot()), 'assignTask'),
    ).toBeUndefined();
  });

  it('appends a bounded summary of hierarchy, assignees, urgency and priorities to the description', () => {
    projectTaskActions.createTask({
      title: 'Write demo copy',
      parent: 'TL-1',
      assignee: 'chris',
      urgency: 'high',
      description: 'Explain the host app',
      source: 'Make the panels editable by hand.',
    });
    projectTaskActions.setStatus('TL-3', 'doing');
    projectTaskActions.addToMyPriorities('TL-3');
    const { description } = projectTasksDefinition(getProjectTasksSnapshot());

    expect(description.startsWith(projectTasksVessel.description)).toBe(true);
    const summary = description.slice(projectTasksVessel.description.length);
    expect(summary).toContain(TASK_SUMMARY_HEADING);
    expect(summary).toContain(
      'TL-1 "Update demo README": top level, assignee Alex, urgency normal, status todo, not in priorities, description "Refresh the setup steps for the demo app."',
    );
    expect(summary).toContain(
      'TL-3 "Write demo copy": parent TL-1, assignee Chris, urgency high, status doing, priority #1, description "Explain the host app", from feedback "Make the panels editable by hand."',
    );
  });

  it('truncates the summary at its character limit and says how many tasks it left out', () => {
    for (let i = 0; i < 60; i++) {
      projectTaskActions.createTask({
        title: `A fairly long generated task title number ${i}`,
      });
    }
    const { description } = projectTasksDefinition(getProjectTasksSnapshot());
    const summary = description.slice(projectTasksVessel.description.length);
    expect(summary.length).toBeLessThanOrEqual(TASK_SUMMARY_CHARACTER_LIMIT);
    expect(summary).toMatch(/and \d+ more tasks\.$/);
  });
});

describe('sourceFeedbackDefinition', () => {
  it('appends the current feedback snapshot to the description', () => {
    feedbackActions.replaceFeedback('Users want dark mode.\nAnd faster loads.');
    const { description } = sourceFeedbackDefinition(getFeedbackSnapshot());
    expect(description).toBe(
      `${sourceFeedbackVessel.description}${FEEDBACK_DESCRIPTION_HEADING}Users want dark mode.\nAnd faster loads.`,
    );
  });

  it('is bounded by the store limit', () => {
    feedbackActions.replaceFeedback('z'.repeat(FEEDBACK_CHARACTER_LIMIT + 500));
    const { description } = sourceFeedbackDefinition(getFeedbackSnapshot());
    expect(description.length).toBe(
      sourceFeedbackVessel.description.length +
        FEEDBACK_DESCRIPTION_HEADING.length +
        FEEDBACK_CHARACTER_LIMIT,
    );
  });
});

describe('TasklaneOptionSync', () => {
  it('republishes both definitions on mount and after a store change', () => {
    render(<TasklaneOptionSync />);
    expect(publishedIds()).toEqual(['project-tasks', 'source-feedback']);

    act(() => {
      projectTaskActions.assignTask('TL-1', 'sam');
    });
    const latest = sync.published.at(-1) as VesselDefinition;
    expect(latest.id).toBe('project-tasks');
    expect(taskEnum(latest, 'assignTask')?.[0]).toBe(
      'TL-1 Update demo README (Sam, normal, not in priorities)',
    );
  });

  it('retries while a command batch is in flight', () => {
    vi.useFakeTimers();
    sync.results = {
      'project-tasks': [
        batchInFlight('project-tasks'),
        batchInFlight('project-tasks'),
      ],
    };
    render(<TasklaneOptionSync />);
    const tasksPublishes = () =>
      sync.published.filter((vessel) => vessel.id === 'project-tasks').length;
    expect(tasksPublishes()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(tasksPublishes()).toBe(2);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(tasksPublishes()).toBe(3);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(tasksPublishes()).toBe(3);
  });
});

function taskEnum(
  vessel: VesselDefinition,
  action: string,
): readonly string[] | undefined {
  return parameter(vessel, action, 'task')?.enum as
    | readonly string[]
    | undefined;
}

function parameter(vessel: VesselDefinition, action: string, name: string) {
  for (const variant of Object.values(vessel.variants)) {
    const found = variant.actions
      .find((candidate) => candidate.name === action)
      ?.parameters?.find((candidate) => candidate.name === name);
    if (found) return found;
  }
  return undefined;
}

function publishedIds(): string[] {
  return [...new Set(sync.published.map((vessel) => vessel.id))].sort();
}

function batchInFlight(vesselId: string) {
  return {
    ok: false,
    conflict: {
      code: 'batch_in_flight',
      vesselId,
      message: 'a command batch is in flight',
    },
  };
}
