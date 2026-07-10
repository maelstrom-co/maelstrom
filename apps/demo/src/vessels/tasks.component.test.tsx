// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypedVesselProps } from '@maelstrom-co/react';
import type { tasksVessel } from './tasks.vessel';

vi.mock('../lib/maelstrom', () => ({
  m: { useActions: vi.fn() },
}));

const { tasksActions } = await import('./tasks.store');
const TasksComponent = (await import('./tasks.component')).default;

function props(): TypedVesselProps<typeof tasksVessel> {
  return {
    instanceId: 'tasks-test',
    variantProps: {},
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof tasksVessel>;
}

beforeEach(() => {
  for (const task of ['Setup CI pipeline', 'Prep design review notes', 'Ship this sprint']) {
    tasksActions.removeTask(task);
  }
});

afterEach(cleanup);

describe('TasksComponent empty state', () => {
  it('shows a suggestion when there are zero tasks', () => {
    const { getByText } = render(<TasksComponent {...props()} />);
    expect(getByText('No tasks yet')).toBeTruthy();
  });

  it('renders the task list once a task exists', () => {
    tasksActions.addTask('Write the launch post');
    const { getByText, queryByText } = render(<TasksComponent {...props()} />);
    expect(getByText('Write the launch post')).toBeTruthy();
    expect(queryByText('No tasks yet')).toBeNull();
  });

  it('renders a checkmark icon for a completed task', () => {
    tasksActions.addTask('Write the launch post');
    tasksActions.checkTask('Write the launch post');
    const { container } = render(<TasksComponent {...props()} />);
    expect(container.querySelector('.task-check--done svg')).not.toBeNull();
  });
});
