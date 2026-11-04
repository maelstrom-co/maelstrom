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
import { projectTasksVessel } from './project-tasks.vessel.def';
import { sourceFeedbackVessel } from './source-feedback.vessel.def';
import { taskDetailVessel } from './task-detail.vessel.def';

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
const {
  __resetBoardFilterStoreForTests,
  boardFilterActions,
  getBoardFilterSnapshot,
} = await import('../stores/board-filter.store');
const { __resetTaskDetailStoreForTests, selectedTaskId, taskDetailActions } =
  await import('../stores/task-detail.store');

beforeEach(() => {
  handlers.clear();
  __resetProjectTasksStoreForTests();
  __resetFeedbackStoreForTests();
  __resetTaskDetailStoreForTests();
  __resetBoardFilterStoreForTests();
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
    expect(within(columnCard('TL-2')).getByText('★1')).toBeTruthy();

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

function declaredActionNames(vessel: VesselDefinition): string[] {
  const names = Object.values(vessel.variants).flatMap((variant) =>
    variant.actions.map((action) => action.name),
  );
  return [...new Set(names)].sort();
}
