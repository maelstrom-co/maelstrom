// @vitest-environment happy-dom

import type { TypedVesselProps } from '@maelstrom-co/react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetActionActivityForTests,
  getActivitySnapshot,
  latestReceiptParts,
} from '../lib/action-activity';
import { tasksVessel } from './tasks.vessel.def';

type Handler = (params?: Record<string, unknown>) => Promise<{
  ok: boolean;
  error?: Error;
}>;

const handlers = new Map<string, Record<string, Handler>>();

vi.mock('../lib/maelstrom', () => ({
  m: {
    useActions: (
      vesselId: string,
      _instanceId: string,
      runners: Record<string, Handler>,
    ) => {
      handlers.set(vesselId, runners);
    },
  },
}));

const { __resetTasksStoreForTests, getTasksSnapshot, tasksActions } =
  await import('./tasks.store');
const TasksComponent = (await import('./tasks.component')).default;

const executeAction = vi.fn(
  async (action: string, params?: Record<string, unknown>) => {
    await handlers.get('tasks')?.[action]?.(params);
  },
);

function props(): TypedVesselProps<typeof tasksVessel> {
  return {
    instanceId: 'tasks-test',
    variantProps: {},
    executeAction,
  } as unknown as TypedVesselProps<typeof tasksVessel>;
}

function clearTasks(): void {
  for (const task of getTasksSnapshot().tasks) tasksActions.removeTask(task.id);
}

function receipt(): string {
  return latestReceiptParts(getActivitySnapshot())
    .map((part) => part.text)
    .join(' · ');
}

async function invoke(action: string, params?: Record<string, unknown>) {
  const handler = handlers.get('tasks')?.[action];
  if (!handler) throw new Error(`tasks.${action} is not registered`);
  let result: Awaited<ReturnType<Handler>> | undefined;
  await act(async () => {
    result = await handler(params);
  });
  return result;
}

beforeEach(() => {
  handlers.clear();
  executeAction.mockClear();
  __resetTasksStoreForTests();
  __resetActionActivityForTests();
});

afterEach(cleanup);

describe('TasksComponent empty state', () => {
  beforeEach(clearTasks);

  it('shows a suggestion when there are zero tasks', () => {
    render(<TasksComponent {...props()} />);
    expect(screen.getByText('No tasks yet')).toBeTruthy();
  });

  it('renders the task list once a task exists', () => {
    tasksActions.addTask('Write the launch post');
    render(<TasksComponent {...props()} />);
    expect(screen.getByText('Write the launch post')).toBeTruthy();
    expect(screen.queryByText('No tasks yet')).toBeNull();
  });

  it('sets the progress tube fill width to the done/total percentage', () => {
    tasksActions.addTask('Write the launch post');
    tasksActions.addTask('Fix the flaky test');
    tasksActions.setTaskDone('Write the launch post', true);
    const { container } = render(<TasksComponent {...props()} />);
    const fill = container.querySelector('.task-tube-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });

  it("renders a done task's checkmark in the dark-ink color, not white, for WCAG contrast against the amber fill", () => {
    tasksActions.addTask('Write the launch post');
    tasksActions.setTaskDone('Write the launch post', true);
    const { container } = render(<TasksComponent {...props()} />);
    const check = container.querySelector(
      '.task-check--done svg',
    ) as SVGElement;
    expect(check).not.toBeNull();
    expect(check.classList.contains('text-bg')).toBe(true);
    expect(check.classList.contains('text-white')).toBe(false);
  });
});

describe('TasksComponent checkboxes', () => {
  beforeEach(() => {
    tasksActions.addTask('Prepare design review', [
      'Check prototype',
      'Write questions',
    ]);
  });

  it('renders tasks and subtasks as labelled checkboxes with their state', () => {
    render(<TasksComponent {...props()} />);
    const ci = screen.getByRole('checkbox', {
      name: 'Mark Setup CI pipeline done',
    });
    expect(ci.getAttribute('aria-checked')).toBe('true');
    const subtask = screen.getByRole('checkbox', {
      name: 'Mark Check prototype done',
    });
    expect(subtask.getAttribute('aria-checked')).toBe('false');
    expect(subtask.tagName).toBe('BUTTON');
  });

  it('checks a subtask on click through executeAction with its id', async () => {
    render(<TasksComponent {...props()} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Mark Check prototype done' }),
      );
    });

    expect(executeAction).toHaveBeenCalledWith('checkSubtask', {
      subtask: 'T-4.1',
    });
    expect(
      screen
        .getByRole('checkbox', { name: 'Mark Check prototype done' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(receipt()).toBe('✓ Checked subtask "Check prototype"');
  });

  it('toggles a task with the keyboard because the checkbox is a native button', async () => {
    render(<TasksComponent {...props()} />);
    const checkbox = screen.getByRole('checkbox', {
      name: 'Mark Ship this sprint done',
    });
    // Native buttons turn Space and Enter into a click; happy-dom does not
    // synthesise that, so the click stands in for the key activation.
    checkbox.focus();
    expect(document.activeElement).toBe(checkbox);
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(executeAction).toHaveBeenCalledWith('checkTask', { task: 'T-3' });

    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(executeAction).toHaveBeenLastCalledWith('uncheckTask', {
      task: 'T-3',
    });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    expect(receipt()).toBe('✓ Unchecked task "Ship this sprint"');
  });

  it('unchecks a done subtask', async () => {
    tasksActions.setSubtaskDone('T-4.2', true);
    render(<TasksComponent {...props()} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Mark Write questions done' }),
      );
    });
    expect(executeAction).toHaveBeenCalledWith('uncheckSubtask', {
      subtask: 'T-4.2',
    });
    expect(receipt()).toBe('✓ Unchecked subtask "Write questions"');
  });

  it('never invokes an Action that switches Variant from a direct edit', async () => {
    const transitioning = new Set<string>(
      Object.values(tasksVessel.variants).flatMap((variant) =>
        variant.actions
          .filter((action) => 'transitionsTo' in action && action.transitionsTo)
          .map((action) => action.name),
      ),
    );
    render(<TasksComponent {...props()} />);
    for (const checkbox of screen.getAllByRole('checkbox')) {
      await act(async () => {
        fireEvent.click(checkbox);
      });
    }
    expect(executeAction.mock.calls.length).toBeGreaterThan(0);
    for (const [action] of executeAction.mock.calls) {
      expect(transitioning.has(action)).toBe(false);
    }
  });
});

describe('Tasks Action handlers', () => {
  it('a click and a request reach the same handler and the same store', async () => {
    tasksActions.addTask('Prepare design review', ['Check prototype']);
    render(<TasksComponent {...props()} />);

    await invoke('checkSubtask', { subtask: 'T-4.1 Check prototype (open)' });
    expect(getTasksSnapshot().tasks[3].subtasks[0].done).toBe(true);
    expect(receipt()).toBe('✓ Checked subtask "Check prototype"');

    await act(async () => {
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Mark Check prototype done' }),
      );
    });
    expect(getTasksSnapshot().tasks[3].subtasks[0].done).toBe(false);
    expect(receipt()).toBe('✓ Unchecked subtask "Check prototype"');
  });

  it('adds a task with subtasks split on the pipe separator', async () => {
    render(<TasksComponent {...props()} />);
    const result = await invoke('addTask', {
      title: 'Prepare design review',
      subtasks: 'Check prototype | Write questions',
    });
    expect(result?.ok).toBe(true);
    expect(
      getTasksSnapshot()
        .tasks.at(-1)
        ?.subtasks.map((s) => s.title),
    ).toEqual(['Check prototype', 'Write questions']);
    expect(receipt()).toBe('✓ Added "Prepare design review" with 2 subtasks');
  });

  it('adds a task without subtasks', async () => {
    render(<TasksComponent {...props()} />);
    await invoke('addTask', { title: 'Book a room' });
    expect(receipt()).toBe('✓ Added "Book a room"');
  });

  it('fails with the current references and records a failure receipt', async () => {
    render(<TasksComponent {...props()} />);
    const result = await invoke('checkTask', { task: 'gym' });
    expect(result?.ok).toBe(false);
    expect(result?.error?.message).toContain(
      'T-2 Prep design review notes (open)',
    );
    expect(receipt()).toBe('✗ Couldn\'t find task "gym"');
  });

  it('fails a subtask lookup with the current subtask references', async () => {
    tasksActions.addTask('Prepare design review', ['Check prototype']);
    render(<TasksComponent {...props()} />);
    const result = await invoke('checkSubtask', { subtask: 'gym' });
    expect(result?.error?.message).toContain('T-4.1 Check prototype (open)');
    expect(receipt()).toBe('✗ Couldn\'t find subtask "gym"');
  });

  it('confirms an already-done task without claiming a change', async () => {
    render(<TasksComponent {...props()} />);
    const result = await invoke('checkTask', { task: 'T-1' });
    expect(result?.ok).toBe(true);
    expect(receipt()).toBe('✓ "Setup CI pipeline" was already done');
  });

  it('removes a task and adds a subtask by reference', async () => {
    render(<TasksComponent {...props()} />);
    await invoke('addSubtask', { task: 'T-2', subtaskTitle: 'Draft agenda' });
    expect(receipt()).toBe(
      '✓ Added subtask "Draft agenda" to "Prep design review notes"',
    );
    await invoke('removeTask', { task: 'T-3 Ship this sprint (open)' });
    expect(receipt()).toBe('✓ Removed task "Ship this sprint"');
  });
});
