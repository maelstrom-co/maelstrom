// @vitest-environment happy-dom

import type { VesselDefinition } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { myPrioritiesVessel } from './my-priorities.vessel.def';
import { projectPulseVessel } from './project-pulse.vessel.def';
import { projectTasksVessel } from './project-tasks.vessel.def';
import { sourceFeedbackVessel } from './source-feedback.vessel.def';
import { taskDetailVessel } from './task-detail.vessel.def';
import { teamLoadVessel } from './team-load.vessel.def';
import { triageInboxVessel } from './triage-inbox.vessel.def';

type Handler = (params?: Record<string, unknown>) => Promise<{
  ok: boolean;
  error?: Error;
}>;

const handlers = new Map<string, Record<string, Handler>>();

const TASKLANE_VESSELS: Readonly<Record<string, VesselDefinition>> = {
  'source-feedback': sourceFeedbackVessel,
  'project-tasks': projectTasksVessel,
  'my-priorities': myPrioritiesVessel,
  'task-detail': taskDetailVessel,
  'team-load': teamLoadVessel,
  'triage-inbox': triageInboxVessel,
  'project-pulse': projectPulseVessel,
};

vi.mock('../maelstrom', () => ({
  tasklaneM: {
    useActions: (
      vesselId: string,
      _instanceId: string,
      runners: Record<string, Handler>,
    ) => {
      handlers.set(vesselId, runners);
    },
  },
}));

const {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
  projectTaskActions,
} = await import('../stores/project-tasks.store');
const {
  __resetFeedbackStoreForTests,
  FEEDBACK_CHARACTER_LIMIT,
  getFeedbackSnapshot,
} = await import('../stores/feedback.store');
const SourceFeedbackComponent = (await import('./source-feedback.component'))
  .default;
const ProjectTasksComponent = (await import('./project-tasks.component'))
  .default;
const MyPrioritiesComponent = (await import('./my-priorities.component'))
  .default;
const TaskDetailComponent = (await import('./task-detail.component')).default;
const TeamLoadComponent = (await import('./team-load.component')).default;
const TriageInboxComponent = (await import('./triage-inbox.component')).default;
const ProjectPulseComponent = (await import('./project-pulse.component'))
  .default;
const { __resetTasklaneActivityForTests, getLatestReceipt } = await import(
  '../tasklane-activity'
);
const {
  __resetBoardFilterStoreForTests,
  boardFilterActions,
  getBoardFilterSnapshot,
} = await import('../stores/board-filter.store');
const {
  __resetTaskDetailStoreForTests,
  getTaskDetailSnapshot,
  taskDetailActions,
} = await import('../stores/task-detail.store');

beforeEach(() => {
  handlers.clear();
  __resetProjectTasksStoreForTests();
  __resetFeedbackStoreForTests();
  __resetTaskDetailStoreForTests();
  __resetBoardFilterStoreForTests();
  __resetTasklaneActivityForTests();
});

afterEach(cleanup);

describe('Feedback Vessel', () => {
  it('shows the seeded feedback as quoted text', () => {
    render(<SourceFeedbackComponent {...props('source-feedback')} />);
    const quotes = screen.getByRole('region', { name: 'Feedback snapshot' });
    expect(quotes.textContent).toContain('real layout tool');
    expect(quotes.textContent).toContain(
      'Team note: maybe use the pet shop as the example app.',
    );
  });

  it('tells the Planner to pass the quote as the task source', () => {
    expect(sourceFeedbackVessel.description).toContain(
      'pass that quote as source',
    );
  });

  it('shows each quote as an item with the tasks that cover it', () => {
    projectTaskActions.createTask({
      title: 'Compact weather',
      source:
        '"The weather panel under the map takes up far too much space. I wanted a small one-line version and could not get one."',
    });
    projectTaskActions.createTask({
      title: 'Shape the screen',
      source: 'i like that I can shape   the screen around how I work.',
    });
    projectTaskActions.createTask({
      title: 'Shape it more',
      source: '“I like that I can shape the screen around how I work.”',
    });
    projectTaskActions.createTask({
      title: 'Tracker sync',
      source:
        '"Could a task panel sync with the tracker my team already uses?"',
    });
    render(<SourceFeedbackComponent {...props('source-feedback')} />);
    act(() => {
      projectTaskActions.removeTask('TL-6');
    });

    expect(feedbackItems()).toEqual([
      ['real layout tool', '○ no task'],
      ['shape the screen', '✓ 2 tasks'],
      ['click and edit things', '○ no task'],
      ['sync with the tracker', '✕ dropped'],
      ['weather panel', '✓ 1 task'],
    ]);
    const quotes = screen.getByRole('region', { name: 'Feedback snapshot' });
    expect(quotes.querySelectorAll('.tasklane-feedback-note')).toHaveLength(2);
  });

  it('shows a paragraph opening with a curly quote as a quote with coverage', async () => {
    render(<SourceFeedbackComponent {...props('source-feedback')} />);
    await invoke('source-feedback', 'replaceFeedback', {
      text: '“This should be editable.”\n\nA team note.',
    });

    expect(screen.getAllByRole('figure')).toHaveLength(1);
    expect(screen.getByRole('figure').textContent).toContain('○ no task');

    act(() => {
      projectTaskActions.createTask({
        title: 'Make it editable',
        source: '“This should be editable.”',
      });
    });
    expect(screen.getByRole('figure').textContent).toContain('✓ 1 task');
  });

  it('edits and saves the feedback through the replaceFeedback Action', async () => {
    const vesselProps = props('source-feedback');
    render(<SourceFeedbackComponent {...vesselProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit feedback' }));
    const editor = screen.getByRole('textbox', { name: 'Feedback text' });
    fireEvent.change(editor, { target: { value: 'Short new feedback' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }));
    });

    expect(vesselProps.executeAction).toHaveBeenCalledWith('replaceFeedback', {
      text: 'Short new feedback',
    });
    expect(getFeedbackSnapshot().text).toBe('Short new feedback');
    expect(screen.queryByRole('textbox', { name: 'Feedback text' })).toBeNull();
  });

  it('cancels an edit with Escape and returns focus to the Edit button', () => {
    const vesselProps = props('source-feedback');
    render(<SourceFeedbackComponent {...vesselProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit feedback' }));
    const editor = screen.getByRole('textbox', { name: 'Feedback text' });
    fireEvent.change(editor, { target: { value: 'Discard me' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Feedback text' })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Edit feedback' }),
    );
    expect(vesselProps.executeAction).not.toHaveBeenCalled();
  });

  it('notes a truncated paste and refuses blank feedback', async () => {
    render(<SourceFeedbackComponent {...props('source-feedback')} />);

    expect(
      await invoke('source-feedback', 'replaceFeedback', {
        text: 'y'.repeat(FEEDBACK_CHARACTER_LIMIT + 1),
      }),
    ).toMatchObject({ ok: true });
    expect(
      screen.getByText(`Truncated to ${FEEDBACK_CHARACTER_LIMIT} characters`),
    ).toBeTruthy();

    const blank = await invoke('source-feedback', 'replaceFeedback', {
      text: '  ',
    });
    expect(blank?.ok).toBe(false);
    expect(blank?.error?.message).toContain('cannot be empty');
  });
});

describe('Tasks Vessel by hand', () => {
  it('lists the seeded tasks with their assignee and urgency controls', () => {
    render(<ProjectTasksComponent {...props('project-tasks')} />);

    const readme = taskRow('Update demo README');
    expect(
      (
        within(readme).getByRole('combobox', {
          name: 'Assignee for Update demo README',
        }) as unknown as HTMLSelectElement
      ).value,
    ).toBe('alex');
    expect(
      (
        within(readme).getByRole('combobox', {
          name: 'Urgency for Update demo README',
        }) as unknown as HTMLSelectElement
      ).value,
    ).toBe('normal');
    expect(screen.queryByRole('list', { name: 'My priorities' })).toBeNull();
  });

  it('reassigns and changes urgency through Actions with task ids', async () => {
    const vesselProps = props('project-tasks');
    render(<ProjectTasksComponent {...vesselProps} />);

    await act(async () => {
      fireEvent.change(
        screen.getByRole('combobox', {
          name: 'Assignee for Update demo README',
        }),
        { target: { value: 'chris' } },
      );
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith('assignTask', {
      task: 'TL-1',
      assignee: 'chris',
    });
    expect(getProjectTasksSnapshot().tasks[0]?.assigneeId).toBe('chris');

    await act(async () => {
      fireEvent.change(
        screen.getByRole('combobox', {
          name: 'Urgency for Record launch video',
        }),
        { target: { value: 'high' } },
      );
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith('setUrgency', {
      task: 'TL-2',
      urgency: 'high',
    });
    expect(getProjectTasksSnapshot().tasks[1]?.urgency).toBe('high');
  });

  it('changes a task status through the setStatus Action', async () => {
    const vesselProps = props('project-tasks');
    render(<ProjectTasksComponent {...vesselProps} />);

    const status = screen.getByRole('combobox', {
      name: 'Status for Update demo README',
    }) as unknown as HTMLSelectElement;
    expect(status.value).toBe('todo');
    expect(Array.from(status.options, (option) => option.text)).toEqual([
      'To do',
      'In progress',
      'Done',
    ]);
    await act(async () => {
      fireEvent.change(status, { target: { value: 'done' } });
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith('setStatus', {
      task: 'TL-1',
      status: 'done',
    });
    expect(getProjectTasksSnapshot().tasks[0]?.status).toBe('done');
  });

  it('nests a task under a parent and offers no parent that would make a cycle', async () => {
    const vesselProps = props('project-tasks');
    render(<ProjectTasksComponent {...vesselProps} />);

    await act(async () => {
      fireEvent.change(
        screen.getByRole('combobox', { name: 'Parent of Record launch video' }),
        { target: { value: 'TL-1' } },
      );
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith('setParent', {
      task: 'TL-2',
      parent: 'TL-1',
    });
    expect(taskRow('Record launch video').getAttribute('data-depth')).toBe('1');

    const parentChoices = Array.from(
      (
        screen.getByRole('combobox', {
          name: 'Parent of Update demo README',
        }) as unknown as HTMLSelectElement
      ).options,
      (option) => option.value,
    );
    expect(parentChoices).toEqual(['none']);
  });

  it('adds to my priorities and badges each prioritised task with its place', async () => {
    const vesselProps = props('project-tasks');
    render(<ProjectTasksComponent {...vesselProps} />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Add Record launch video to my priorities',
        }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Add Update demo README to my priorities',
        }),
      );
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith(
      'addToMyPriorities',
      { task: 'TL-2' },
    );
    expect(priorityBadge('Record launch video')).toBe('★1');
    expect(priorityBadge('Update demo README')).toBe('★2');
    expect(
      within(taskRow('Update demo README')).getByRole('img', {
        name: 'Priority 2 in my priorities',
      }).textContent,
    ).toBe('★2');

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Remove Record launch video from my priorities',
        }),
      );
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith(
      'removeFromMyPriorities',
      { task: 'TL-2' },
    );
    expect(priorityBadge('Record launch video')).toBeNull();
    expect(priorityBadge('Update demo README')).toBe('★1');
    expect(getProjectTasksSnapshot().tasks.map((task) => task.urgency)).toEqual(
      ['normal', 'normal'],
    );
  });

  it('edits the title and description inline and commits once on Save', async () => {
    const vesselProps = props('project-tasks');
    render(<ProjectTasksComponent {...vesselProps} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Update demo README' }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Update the demo README' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Explain the host app.' },
    });
    expect(vesselProps.executeAction).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(vesselProps.executeAction).toHaveBeenCalledTimes(1);
    expect(vesselProps.executeAction).toHaveBeenCalledWith('updateTask', {
      task: 'TL-1',
      title: 'Update the demo README',
      description: 'Explain the host app.',
    });
    expect(getProjectTasksSnapshot().tasks[0]).toMatchObject({
      title: 'Update the demo README',
      description: 'Explain the host app.',
    });
  });

  it('keeps editor labels and focus inside each Instance when two are on screen', () => {
    render(
      <>
        <ProjectTasksComponent {...props('project-tasks', 'tasks-left')} />
        <ProjectTasksComponent {...props('project-tasks', 'tasks-right')} />
      </>,
    );
    const editButtons = screen.getAllByRole('button', {
      name: 'Edit Update demo README',
    });
    for (const button of editButtons) fireEvent.click(button);

    expect(screen.getAllByRole('textbox', { name: 'Title' })).toHaveLength(2);

    const rightTitle = screen.getAllByRole('textbox', { name: 'Title' })[1];
    if (!rightTitle) throw new Error('no second Title field');
    fireEvent.keyDown(rightTitle, { key: 'Escape' });

    const rightEdit = screen.getAllByRole('button', {
      name: 'Edit Update demo README',
    });
    expect(rightEdit).toHaveLength(1);
    expect(document.activeElement).toBe(rightEdit[0]);
  });

  it('cancels an inline edit with Escape and returns focus to its Edit button', () => {
    const vesselProps = props('project-tasks');
    render(<ProjectTasksComponent {...vesselProps} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Update demo README' }),
    );
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Discarded' } });
    fireEvent.keyDown(title, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Edit Update demo README' }),
    );
    expect(vesselProps.executeAction).not.toHaveBeenCalled();
  });

  it('deletes a task only after the confirm step', async () => {
    const vesselProps = props('project-tasks');
    render(<ProjectTasksComponent {...vesselProps} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Update demo README' }),
    );
    expect(vesselProps.executeAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep task' }));
    expect(getProjectTasksSnapshot().tasks).toHaveLength(2);

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Update demo README' }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Confirm delete Update demo README',
        }),
      );
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith('removeTask', {
      task: 'TL-1',
    });
    expect(getProjectTasksSnapshot().tasks.map((task) => task.id)).toEqual([
      'TL-2',
    ]);
  });

  it('keeps every control a focusable native element', () => {
    render(<ProjectTasksComponent {...props('project-tasks')} />);
    const row = taskRow('Update demo README');
    const controls = [
      ...within(row).getAllByRole('combobox'),
      ...within(row).getAllByRole('button'),
    ];
    expect(controls.length).toBeGreaterThanOrEqual(6);
    for (const control of controls) {
      expect(['SELECT', 'BUTTON']).toContain(control.tagName);
      control.focus();
      expect(document.activeElement).toBe(control);
    }
  });
});

describe('Tasks board assignee filter', () => {
  it("shows only the filtered member's tasks with a chip that clears the filter", async () => {
    projectTaskActions.createTask({
      title: 'Alex child',
      parent: 'TL-2',
      assignee: 'alex',
    });
    const vesselProps = props('project-tasks');
    render(<ProjectTasksComponent {...vesselProps} />);

    expect(
      await invoke('project-tasks', 'filterByAssignee', { assignee: 'alex' }),
    ).toMatchObject({ ok: true });
    expect(listedTitles()).toEqual(['Update demo README', 'Alex child']);
    expect(taskRow('Alex child').getAttribute('data-depth')).toBe('0');
    const chip = screen.getByRole('status', { name: 'Board filter' });
    expect(chip.textContent).toContain("Showing Alex's tasks");

    await act(async () => {
      fireEvent.click(within(chip).getByRole('button', { name: 'Clear' }));
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith('filterByAssignee', {
      assignee: 'everyone',
    });
    expect(getBoardFilterSnapshot().assigneeFilter).toBeNull();
    expect(screen.queryByRole('status', { name: 'Board filter' })).toBeNull();
    expect(listedTitles()).toEqual([
      'Update demo README',
      'Record launch video',
      'Alex child',
    ]);
  });

  it('counts the shown tasks out of all tasks while a filter is active', async () => {
    render(<ProjectTasksComponent {...props('project-tasks')} />);
    expect(screen.getByText('Maelstrom demo · 2 tasks')).toBeTruthy();
    await invoke('project-tasks', 'filterByAssignee', { assignee: 'sam' });
    expect(screen.getByText('Maelstrom demo · 1 of 2 tasks')).toBeTruthy();
  });

  it('says so when the filtered member has no tasks, and calls Chris "my"', () => {
    act(() => {
      boardFilterActions.filterByAssignee('me');
    });
    render(<ProjectTasksComponent {...props('project-tasks')} />);
    expect(
      screen.getByRole('status', { name: 'Board filter' }).textContent,
    ).toContain('Showing my tasks');
    expect(screen.getByText('No tasks for Chris.')).toBeTruthy();
  });

  it('refuses an unknown team member and names the choices', async () => {
    render(<ProjectTasksComponent {...props('project-tasks')} />);
    const result = await invoke('project-tasks', 'filterByAssignee', {
      assignee: 'robin',
    });
    expect(result?.ok).toBe(false);
    expect(result?.error?.message).toBe(
      'No team member matches "robin". Use chris (Chris, me), alex (Alex), sam (Sam), or everyone to clear the filter.',
    );
  });
});

describe('Tasks board columns variant', () => {
  it('declares a wide columns variant next to the board', () => {
    expect(Object.keys(projectTasksVessel.variants)).toEqual([
      'board',
      'columns',
    ]);
    expect(projectTasksVessel.variants.columns.minSize).toEqual({
      width: 9,
      height: 4,
    });
    expect(
      projectTasksVessel.variants.columns.actions.map((action) => action.name),
    ).toEqual(
      projectTasksVessel.variants.board.actions.map((action) => action.name),
    );
  });

  it('places each task in the column for its status and moves it on a status change', async () => {
    projectTaskActions.setStatus('TL-2', 'doing');
    projectTaskActions.addToMyPriorities('TL-2');
    const vesselProps = props('project-tasks', 'tasks-columns', 'columns');
    render(<ProjectTasksComponent {...vesselProps} />);

    expect(columnTaskIds()).toEqual({
      'To do': ['TL-1'],
      'In progress': ['TL-2'],
      Done: [],
    });
    expect(
      within(columnCard('TL-2')).getByRole('img', {
        name: 'Priority 1 in my priorities',
      }).textContent,
    ).toBe('★1');

    await act(async () => {
      fireEvent.change(
        within(columnCard('TL-1')).getByRole('combobox', {
          name: 'Status for Update demo README',
        }),
        { target: { value: 'done' } },
      );
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith('setStatus', {
      task: 'TL-1',
      status: 'done',
    });
    expect(columnTaskIds()).toEqual({
      'To do': [],
      'In progress': ['TL-2'],
      Done: ['TL-1'],
    });
  });

  it('respects the assignee filter', () => {
    act(() => {
      boardFilterActions.filterByAssignee('sam');
    });
    render(
      <ProjectTasksComponent
        {...props('project-tasks', 'tasks-columns', 'columns')}
      />,
    );
    expect(columnTaskIds()).toEqual({
      'To do': ['TL-2'],
      'In progress': [],
      Done: [],
    });
    expect(
      screen.getByRole('status', { name: 'Board filter' }).textContent,
    ).toContain("Showing Sam's tasks");
  });
});

describe('My priorities Vessel', () => {
  it('says when there are no priorities yet', () => {
    render(<MyPrioritiesComponent {...props('my-priorities')} />);
    expect(screen.getByText('No tasks in your priorities yet.')).toBeTruthy();
  });

  it('lists my priorities in order and reorders them without touching urgency', async () => {
    projectTaskActions.addToMyPriorities('TL-1');
    projectTaskActions.addToMyPriorities('TL-2');
    const vesselProps = props('my-priorities');
    render(<MyPrioritiesComponent {...vesselProps} />);

    const priorities = screen.getByRole('list', { name: 'My priorities' });
    expect(
      within(priorities)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-task-id')),
    ).toEqual(['TL-1', 'TL-2']);
    expect(
      (
        within(priorities).getByRole('button', {
          name: 'Move Update demo README up',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await act(async () => {
      fireEvent.click(
        within(priorities).getByRole('button', {
          name: 'Move Record launch video up',
        }),
      );
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith(
      'addToMyPriorities',
      { task: 'TL-2', position: 1 },
    );
    expect(getProjectTasksSnapshot().myPriorities).toEqual(['TL-2', 'TL-1']);

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Remove Record launch video from my priorities',
        }),
      );
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith(
      'removeFromMyPriorities',
      { task: 'TL-2' },
    );
    expect(getProjectTasksSnapshot().myPriorities).toEqual(['TL-1']);
    expect(getProjectTasksSnapshot().tasks.map((task) => task.urgency)).toEqual(
      ['normal', 'normal'],
    );
  });

  it('shows the strip variant as one compact line without controls', () => {
    projectTaskActions.addToMyPriorities('TL-2');
    projectTaskActions.addToMyPriorities('TL-1');
    render(
      <MyPrioritiesComponent
        {...props('my-priorities', 'priorities-strip', 'strip')}
      />,
    );

    const strip = screen.getByRole('list', { name: 'My priorities' });
    expect(
      within(strip)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1Record launch video', '2Update demo README']);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('runs priority Actions sent by the Planner', async () => {
    render(<MyPrioritiesComponent {...props('my-priorities')} />);
    expect(
      await invoke('my-priorities', 'addToMyPriorities', { task: 'TL-2' }),
    ).toMatchObject({ ok: true });
    expect(
      within(screen.getByRole('list', { name: 'My priorities' }))
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-task-id')),
    ).toEqual(['TL-2']);
    const missing = await invoke('my-priorities', 'removeFromMyPriorities', {
      task: 'TL-1',
    });
    expect(missing?.error?.message).toContain('is not in your priorities');
  });
});

describe('Team load Vessel', () => {
  it('declares a small bars variant that shares the board filter Action', () => {
    expect(Object.keys(teamLoadVessel.variants)).toEqual(['bars']);
    expect(teamLoadVessel.variants.bars.minSize).toEqual({
      width: 4,
      height: 3,
    });
    expect(teamLoadVessel.variants.bars.actions).toEqual(
      projectTasksVessel.variants.board.actions.filter(
        (action) => action.name === 'filterByAssignee',
      ),
    );
  });

  it('shows each team member with open tasks, their share and the urgent count', () => {
    projectTaskActions.createTask({
      title: 'Urgent fix',
      assignee: 'alex',
      urgency: 'high',
    });
    projectTaskActions.createTask({ title: 'Loose end' });
    projectTaskActions.createTask({ title: 'Shipped', assignee: 'sam' });
    projectTaskActions.setStatus('TL-5', 'done');
    render(<TeamLoadComponent {...props('team-load')} />);

    const rows = within(
      screen.getByRole('list', { name: 'Team load' }),
    ).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-member-id'))).toEqual([
      'chris',
      'alex',
      'sam',
    ]);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Chris0 tasks0 urgent',
      'Alex2 tasks1 urgent',
      'Sam1 task0 urgent',
    ]);
    expect(rows.map((row) => shareOf(row))).toEqual(['0%', '50%', '25%']);
  });

  it('filters the board by the clicked member and clears it on a second click', async () => {
    const vesselProps = props('team-load');
    render(<TeamLoadComponent {...vesselProps} />);
    const alex = () => screen.getByRole('button', { name: /^Alex,/ });
    expect(alex().getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      fireEvent.click(alex());
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith('filterByAssignee', {
      assignee: 'alex',
    });
    expect(getBoardFilterSnapshot().assigneeFilter).toBe('alex');
    expect(alex().getAttribute('aria-pressed')).toBe('true');
    expect(
      screen
        .getByRole('button', { name: /^Sam,/ })
        .getAttribute('aria-pressed'),
    ).toBe('false');

    await act(async () => {
      fireEvent.click(alex());
    });
    expect(vesselProps.executeAction).toHaveBeenLastCalledWith(
      'filterByAssignee',
      { assignee: 'everyone' },
    );
    expect(getBoardFilterSnapshot().assigneeFilter).toBeNull();
    expect(alex().getAttribute('aria-pressed')).toBe('false');
  });

  it('says which member the board is filtered to, even with no board on screen', async () => {
    render(<TeamLoadComponent {...props('team-load')} />);
    expect(screen.queryByText(/Board filtered to/)).toBeNull();

    expect(
      await invoke('team-load', 'filterByAssignee', { assignee: 'alex' }),
    ).toMatchObject({ ok: true });
    expect(screen.getByRole('status').textContent).toBe(
      'Board filtered to Alex',
    );

    await invoke('team-load', 'filterByAssignee', { assignee: 'everyone' });
    expect(screen.queryByText(/Board filtered to/)).toBeNull();
  });

  it('marks the member a filter set elsewhere selected', () => {
    act(() => {
      boardFilterActions.filterByAssignee('sam');
    });
    render(<TeamLoadComponent {...props('team-load')} />);
    const sam = screen.getByRole('button', { name: /^Sam,/ });
    expect(sam.tagName).toBe('BUTTON');
    expect(sam.getAttribute('aria-pressed')).toBe('true');
    expect(sam.getAttribute('data-active')).toBe('true');
  });
});

describe('Triage inbox Vessel', () => {
  it('declares a small list variant that shares the board assignTask Action', () => {
    expect(Object.keys(triageInboxVessel.variants)).toEqual(['list']);
    expect(triageInboxVessel.variants.list.minSize).toEqual({
      width: 4,
      height: 3,
    });
    expect(triageInboxVessel.variants.list.actions).toEqual(
      projectTasksVessel.variants.board.actions.filter(
        (action) => action.name === 'assignTask',
      ),
    );
  });

  it('lists open tasks with no owner or no parent, each with its reasons', () => {
    projectTaskActions.createTask({ title: 'Grouping task', assignee: 'alex' });
    projectTaskActions.createTask({ title: 'Owned child', parent: 'TL-3' });
    projectTaskActions.assignTask('TL-4', 'sam');
    projectTaskActions.createTask({ title: 'Unowned child', parent: 'TL-3' });
    projectTaskActions.createTask({ title: 'Loose and unowned' });
    projectTaskActions.createTask({ title: 'Finished loose' });
    projectTaskActions.setStatus('TL-7', 'done');
    render(<TriageInboxComponent {...props('triage-inbox')} />);

    expect(triageRows()).toEqual([
      { id: 'TL-1', reasons: ['no parent'] },
      { id: 'TL-2', reasons: ['no parent'] },
      { id: 'TL-5', reasons: ['no owner'] },
      { id: 'TL-6', reasons: ['no owner', 'no parent'] },
    ]);
  });

  it('assigns a task inline through assignTask and records a receipt', async () => {
    projectTaskActions.createTask({ title: 'Unowned child', parent: 'TL-1' });
    const vesselProps = props('triage-inbox');
    render(<TriageInboxComponent {...vesselProps} />);

    const select = screen.getByRole('combobox', {
      name: 'Assign Unowned child',
    }) as unknown as HTMLSelectElement;
    expect(select.value).toBe('unassigned');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'sam' } });
    });

    expect(vesselProps.executeAction).toHaveBeenCalledWith('assignTask', {
      task: 'TL-3',
      assignee: 'sam',
    });
    expect(getProjectTasksSnapshot().tasks.at(-1)?.assigneeId).toBe('sam');
    expect(getLatestReceipt()?.text).toBe('✓ Assigned "Unowned child" to Sam');
    expect(triageRows().map((row) => row.id)).toEqual(['TL-2']);
  });

  it('says the inbox is clear when every open task has an owner and a place', () => {
    projectTaskActions.setParent('TL-2', 'TL-1');
    render(<TriageInboxComponent {...props('triage-inbox')} />);
    expect(screen.queryByRole('list', { name: 'Triage inbox' })).toBeNull();
    expect(screen.getByText('Inbox clear ✓')).toBeTruthy();
  });

  it('returns the board error for an unknown task', async () => {
    render(<TriageInboxComponent {...props('triage-inbox')} />);
    const result = await invoke('triage-inbox', 'assignTask', {
      task: 'Ghost',
      assignee: 'alex',
    });
    expect(result?.error?.message).toContain(
      'TL-1 Update demo README, TL-2 Record launch video',
    );
  });
});

describe('Project pulse Vessel', () => {
  it('declares a read-only 2x2 tile variant', () => {
    expect(Object.keys(projectPulseVessel.variants)).toEqual(['tile']);
    expect(projectPulseVessel.variants.tile.minSize).toEqual({
      width: 2,
      height: 2,
    });
    expect(projectPulseVessel.variants.tile.actions).toEqual([]);
  });

  it('shows the seeded project as two tasks, none urgent or unowned, 0% done', () => {
    render(<ProjectPulseComponent {...props('project-pulse')} />);
    expect(pulseStats()).toEqual({
      total: '2',
      urgent: '0',
      unowned: '0',
      done: '0%',
    });
  });

  it('counts open urgent and unowned tasks and rounds the share done', () => {
    projectTaskActions.createTask({ title: 'Hot fix', urgency: 'high' });
    projectTaskActions.createTask({ title: 'Shipped orphan', urgency: 'high' });
    projectTaskActions.setStatus('TL-4', 'done');
    render(<ProjectPulseComponent {...props('project-pulse')} />);
    expect(pulseStats()).toEqual({
      total: '4',
      urgent: '1',
      unowned: '1',
      done: '25%',
    });

    act(() => {
      projectTaskActions.removeTask('TL-3');
    });
    expect(pulseStats().done).toBe('33%');
    act(() => {
      projectTaskActions.setStatus('TL-1', 'done');
    });
    expect(pulseStats().done).toBe('67%');
  });

  it('shows 0% done when there are no tasks', () => {
    act(() => {
      projectTaskActions.removeTask('TL-1');
      projectTaskActions.removeTask('TL-2');
    });
    render(<ProjectPulseComponent {...props('project-pulse')} />);
    expect(pulseStats()).toEqual({
      total: '0',
      urgent: '0',
      unowned: '0',
      done: '0%',
    });
  });
});

describe('Task detail Vessel', () => {
  it('asks for a task until showTask runs', () => {
    render(<TaskDetailComponent {...props('task-detail', 'detail-1')} />);
    expect(screen.getByText(/No task open yet/)).toBeTruthy();
  });

  it('shows every field of the task the receiving Instance was sent', async () => {
    projectTaskActions.createTask({
      title: 'Add a compact weather view',
      description: 'A one-line weather variant.',
      parent: 'TL-1',
      assignee: 'chris',
      urgency: 'high',
      source: 'I wanted a small one-line version.',
    });
    projectTaskActions.createTask({
      title: 'Measure the strip',
      parent: 'TL-3',
    });
    projectTaskActions.setStatus('TL-3', 'doing');
    render(<TaskDetailComponent {...props('task-detail', 'detail-1')} />);

    expect(
      await invoke('task-detail', 'showTask', { task: 'TL-3' }),
    ).toMatchObject({ ok: true });
    expect(selectedTaskId('detail-1')).toBe('TL-3');

    const detail = screen.getByRole('article', {
      name: 'TL-3 Add a compact weather view',
    });
    const fields = within(detail);
    expect(fields.getByText('Chris')).toBeTruthy();
    expect(fields.getByText('high')).toBeTruthy();
    expect(fields.getByText('In progress')).toBeTruthy();
    expect(fields.getByText('A one-line weather variant.')).toBeTruthy();
    expect(
      fields.getByRole('button', { name: 'Open TL-1 Update demo README' }),
    ).toBeTruthy();
    expect(detail.querySelector('blockquote')?.textContent).toBe(
      'I wanted a small one-line version.',
    );
    expect(
      within(fields.getByRole('list', { name: 'Subtasks' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['TL-4 Measure the strip']);
  });

  it('opens a subtask in the same Instance when clicked', async () => {
    projectTaskActions.createTask({ title: 'Child', parent: 'TL-1' });
    const vesselProps = props('task-detail', 'detail-1');
    render(<TaskDetailComponent {...vesselProps} />);
    await invoke('task-detail', 'showTask', { task: 'TL-1' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open TL-3 Child' }));
    });
    expect(vesselProps.executeAction).toHaveBeenCalledWith('showTask', {
      task: 'TL-3',
    });
    expect(selectedTaskId('detail-1')).toBe('TL-3');
  });

  it('keeps one task per Instance when two are on screen', () => {
    act(() => {
      taskDetailActions.showTask('detail-left', 'TL-1');
      taskDetailActions.showTask('detail-right', 'TL-2');
    });
    render(
      <>
        <TaskDetailComponent {...props('task-detail', 'detail-left')} />
        <TaskDetailComponent {...props('task-detail', 'detail-right')} />
      </>,
    );
    expect(
      screen
        .getAllByRole('article')
        .map((article) => article.getAttribute('aria-label')),
    ).toEqual(['TL-1 Update demo README', 'TL-2 Record launch video']);
  });

  it('keeps its task across a remount, as the Instance still exists', async () => {
    const first = render(
      <TaskDetailComponent {...props('task-detail', 'detail-1')} />,
    );
    await invoke('task-detail', 'showTask', { task: 'TL-2' });
    expect(selectedTaskId('detail-1')).toBe('TL-2');

    first.unmount();
    expect(selectedTaskId('detail-1')).toBe('TL-2');
    render(<TaskDetailComponent {...props('task-detail', 'detail-1')} />);
    expect(
      screen.getByRole('article', { name: /Record launch video/ }),
    ).toBeTruthy();
  });

  it('says when the open task was deleted', async () => {
    render(<TaskDetailComponent {...props('task-detail', 'detail-1')} />);
    await invoke('task-detail', 'showTask', { task: 'TL-2' });
    act(() => {
      projectTaskActions.removeTask('TL-2');
    });
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText(/TL-2 was deleted/)).toBeTruthy();
  });

  it('returns an error listing the current tasks for an unknown task', async () => {
    render(<TaskDetailComponent {...props('task-detail', 'detail-1')} />);
    const result = await invoke('task-detail', 'showTask', { task: 'Ghost' });
    expect(result?.ok).toBe(false);
    expect(result?.error?.message).toContain(
      'TL-1 Update demo README, TL-2 Record launch video',
    );
    expect(selectedTaskId('detail-1')).toBeNull();
  });
});

describe('Tasks Vessel through Actions', () => {
  it('creates a parent and children under it by title in plan order', async () => {
    render(<ProjectTasksComponent {...props('project-tasks')} />);

    expect(
      await invoke('project-tasks', 'createTask', {
        title: 'Improve the demo',
      }),
    ).toMatchObject({ ok: true });
    expect(
      await invoke('project-tasks', 'createTask', {
        title: 'Write demo copy',
        description: 'Explain the host app',
        parent: 'Improve the demo',
        assignee: 'chris',
        urgency: 'high',
        source: 'Can I edit things inside the panels?',
      }),
    ).toMatchObject({ ok: true });

    expect(taskRow('Write demo copy').getAttribute('data-depth')).toBe('1');
    expect(getProjectTasksSnapshot().tasks.at(-1)).toMatchObject({
      id: 'TL-4',
      parentId: 'TL-3',
      assigneeId: 'chris',
      urgency: 'high',
      status: 'todo',
      sourceFeedback: 'Can I edit things inside the panels?',
    });
  });

  it('returns errors that list the current references and team ids', async () => {
    render(<ProjectTasksComponent {...props('project-tasks')} />);

    const unknownTask = await invoke('project-tasks', 'assignTask', {
      task: 'Ghost',
      assignee: 'alex',
    });
    expect(unknownTask?.ok).toBe(false);
    expect(unknownTask?.error?.message).toContain(
      'TL-1 Update demo README, TL-2 Record launch video',
    );

    const unknownAssignee = await invoke('project-tasks', 'assignTask', {
      task: 'TL-1',
      assignee: 'robin',
    });
    expect(unknownAssignee?.error?.message).toContain('chris (Chris, me)');

    const cycle = await invoke('project-tasks', 'setParent', {
      task: 'TL-1',
      parent: 'TL-1',
    });
    expect(cycle?.error?.message).toContain('cannot be its own parent');
  });

  it('registers a runner for every Action each definition declares', () => {
    render(<SourceFeedbackComponent {...props('source-feedback')} />);
    render(<ProjectTasksComponent {...props('project-tasks')} />);
    render(<MyPrioritiesComponent {...props('my-priorities')} />);
    render(<TaskDetailComponent {...props('task-detail')} />);
    render(<TeamLoadComponent {...props('team-load')} />);
    render(<TriageInboxComponent {...props('triage-inbox')} />);
    render(<ProjectPulseComponent {...props('project-pulse')} />);

    const registered = Object.fromEntries(
      Object.keys(TASKLANE_VESSELS).map((vesselId) => [
        vesselId,
        Object.keys(handlers.get(vesselId) ?? {}).sort(),
      ]),
    );
    const declared = Object.fromEntries(
      Object.entries(TASKLANE_VESSELS).map(([vesselId, vessel]) => [
        vesselId,
        declaredActionNames(vessel),
      ]),
    );
    expect(registered).toEqual(declared);
  });

  it('declares no Variant transition, so direct edits never re-plan', () => {
    for (const vessel of Object.values(TASKLANE_VESSELS)) {
      for (const variant of Object.values(vessel.variants)) {
        for (const action of variant.actions) {
          expect(action.transitionsTo, `${vessel.id}.${action.name}`).toBe(
            undefined,
          );
        }
      }
    }
  });

  it('reflects a change made through the store while mounted', () => {
    render(<ProjectTasksComponent {...props('project-tasks')} />);
    act(() => {
      projectTaskActions.createTask({ title: 'Added elsewhere' });
    });
    expect(taskRow('Added elsewhere')).toBeTruthy();
  });
});

interface TestVesselProps {
  readonly instanceId: string;
  readonly variantProps: { readonly variant: string };
  readonly executeAction: ReturnType<typeof vi.fn>;
}

// executeAction stands in for the client: it runs the handler the component
// registered, the same one the Engine path invokes.
function props(
  vesselId: string,
  instanceId = 'test',
  variant = TASKLANE_VESSELS[vesselId]?.defaultVariant ?? 'default',
): TestVesselProps & TypedVesselProps<never> {
  const executeAction = vi.fn(
    (name: string, params?: Record<string, unknown>) => {
      void handlers.get(vesselId)?.[name]?.(params);
    },
  );
  return {
    instanceId,
    variantProps: { variant },
    executeAction,
  } as unknown as TestVesselProps & TypedVesselProps<never>;
}

async function invoke(
  vesselId: string,
  action: string,
  params?: Record<string, unknown>,
) {
  const handler = handlers.get(vesselId)?.[action];
  if (!handler) throw new Error(`${vesselId}.${action} is not registered`);
  let result: Awaited<ReturnType<Handler>> | undefined;
  await act(async () => {
    result = await handler(params);
  });
  return result;
}

function selectedTaskId(instanceId: string): string | null {
  return getTaskDetailSnapshot().get(instanceId) ?? null;
}

function taskRow(title: string): HTMLElement {
  const row = screen
    .getAllByRole('listitem')
    .find(
      (item) =>
        item.hasAttribute('data-depth') &&
        item.querySelector('.tasklane-task-title')?.textContent === title,
    );
  if (!row) throw new Error(`no task row titled ${title}`);
  return row;
}

function listedTitles(): string[] {
  return screen
    .getAllByRole('listitem')
    .filter((item) => item.hasAttribute('data-depth'))
    .map(
      (item) => item.querySelector('.tasklane-task-title')?.textContent ?? '',
    );
}

function columnTaskIds(): Record<string, string[]> {
  return Object.fromEntries(
    ['To do', 'In progress', 'Done'].map((name) => [
      name,
      within(screen.getByRole('list', { name }))
        .queryAllByRole('listitem')
        .map((item) => item.getAttribute('data-task-id') ?? ''),
    ]),
  );
}

function columnCard(taskId: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(
    `.tasklane-card[data-task-id="${taskId}"]`,
  );
  if (!card) throw new Error(`no column card for ${taskId}`);
  return card;
}

function priorityBadge(title: string): string | null {
  return (
    taskRow(title).querySelector('.tasklane-priority-badge')?.textContent ??
    null
  );
}

const FEEDBACK_ITEM_KEYS = [
  'real layout tool',
  'shape the screen',
  'click and edit things',
  'sync with the tracker',
  'weather panel',
];

function feedbackItems(): [string, string][] {
  return screen.getAllByRole('figure').map((item) => {
    const quote = item.querySelector('blockquote')?.textContent ?? '';
    const key =
      FEEDBACK_ITEM_KEYS.find((candidate) => quote.includes(candidate)) ??
      quote;
    return [key, item.querySelector('figcaption')?.textContent ?? ''];
  });
}

function pulseStats(): Record<string, string> {
  const pulse = screen.getByRole('region', { name: 'Project pulse' });
  return Object.fromEntries(
    Array.from(pulse.querySelectorAll('[data-stat]'), (stat) => [
      stat.getAttribute('data-stat') ?? '',
      stat.querySelector('dd')?.textContent ?? '',
    ]),
  );
}

function triageRows(): { id: string; reasons: string[] }[] {
  return within(screen.getByRole('list', { name: 'Triage inbox' }))
    .getAllByRole('listitem')
    .map((item) => ({
      id: item.getAttribute('data-task-id') ?? '',
      reasons: Array.from(
        item.querySelectorAll('[data-reason]'),
        (tag) => tag.textContent ?? '',
      ),
    }));
}

function shareOf(row: HTMLElement): string | null {
  return (
    row
      .querySelector<HTMLElement>('[data-share]')
      ?.getAttribute('data-share') ?? null
  );
}

function declaredActionNames(vessel: VesselDefinition): string[] {
  const names = Object.values(vessel.variants).flatMap((variant) =>
    variant.actions.map((action) => action.name),
  );
  return [...new Set(names)].sort();
}
