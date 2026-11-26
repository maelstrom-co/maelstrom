// @vitest-environment happy-dom

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

import type { flexibleTableVessel } from './flexible-table.vessel.def';

type Handler = (params?: Record<string, unknown>) => Promise<{
  ok: boolean;
  error?: Error;
}>;

const handlers = new Map<string, Record<string, Handler>>();

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

const { __resetProjectTasksStoreForTests, projectTaskActions } =
  await import('../stores/project-tasks.store');
const { __resetFlexibleTableStoreForTests } =
  await import('../stores/flexible-table.store');
const { __resetTasklaneActivityForTests } =
  await import('../tasklane-activity');
const FlexibleTableComponent = (await import('./flexible-table.component'))
  .default;

beforeEach(() => {
  handlers.clear();
  __resetProjectTasksStoreForTests();
  __resetFlexibleTableStoreForTests();
  __resetTasklaneActivityForTests();
});

afterEach(cleanup);

function tableProps(): TypedVesselProps<typeof flexibleTableVessel> {
  return {
    instanceId: 'flexible-table-test',
    vesselId: 'flexible-table',
    variant: 'table',
    props: {},
    executeAction: vi.fn((action: string, params?: Record<string, unknown>) => {
      const handler = handlers.get('flexible-table')?.[action];
      if (handler) void handler(params);
    }),
  } as unknown as TypedVesselProps<typeof flexibleTableVessel>;
}

async function invoke(action: string, params?: Record<string, unknown>) {
  const handler = handlers.get('flexible-table')?.[action];
  if (!handler) throw new Error(`Missing handler for ${action}`);
  let result: { ok: boolean; error?: Error } = { ok: false };
  await act(async () => {
    result = await handler(params);
  });
  return result;
}

describe('FlexibleTableComponent', () => {
  it('renders computed columns summing estimate and spent', async () => {
    render(<FlexibleTableComponent {...tableProps()} />);

    const result = await invoke('addColumn', {
      label: 'Total',
      kind: 'computed',
      formula: 'estimate + spent',
    });
    expect(result.ok).toBe(true);

    const table = screen.getByRole('table', { name: 'Flexible table' });
    const tl1Row = table.querySelector('tr[data-task-id="TL-1"]')!;
    const tl2Row = table.querySelector('tr[data-task-id="TL-2"]')!;

    expect(
      tl1Row.querySelector('td[data-column-id="total"]')?.textContent,
    ).toBe('3');
    expect(
      tl2Row.querySelector('td[data-column-id="total"]')?.textContent,
    ).toBe('7');
  });

  it('renders editable cells for a free column and updates them via action or input', async () => {
    projectTaskActions.createTask({ title: 'Polish docs' }); // TL-3
    render(<FlexibleTableComponent {...tableProps()} />);

    expect(
      (await invoke('addColumn', { label: 'Notes', kind: 'free' })).ok,
    ).toBe(true);

    expect(
      (
        await invoke('setCell', {
          task: 'TL-3',
          column: 'notes',
          value: 'blocked',
        })
      ).ok,
    ).toBe(true);

    const input = screen.getByLabelText('Notes for TL-3') as HTMLInputElement;
    expect(input.value).toBe('blocked');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'ready' } });
    });
    expect(input.value).toBe('ready');
  });

  it('returns typed errors for a bad formula or unknown column without crashing', async () => {
    render(<FlexibleTableComponent {...tableProps()} />);

    const badFormula = await invoke('addColumn', {
      label: 'Bad',
      kind: 'computed',
      formula: 'estimate / (',
    });
    expect(badFormula.ok).toBe(false);
    expect(badFormula.error?.message).toContain('Invalid formula');

    const unknownCol = await invoke('sortBy', {
      column: 'nonexistent',
      direction: 'desc',
    });
    expect(unknownCol.ok).toBe(false);
    expect(unknownCol.error?.message).toContain('Unknown column');

    expect(screen.getByRole('table', { name: 'Flexible table' })).toBeTruthy();
  });

  it('switches to the triage preset showing only tasks with no owner or no parent', async () => {
    projectTaskActions.createTask({
      title: 'Assigned child',
      parent: 'TL-1',
      assignee: 'chris',
    }); // TL-3 (covered)
    projectTaskActions.createTask({
      title: 'Unassigned child',
      parent: 'TL-1',
      assignee: 'unassigned',
    }); // TL-4 (no owner)
    projectTaskActions.setStatus('TL-2', 'done');

    render(<FlexibleTableComponent {...tableProps()} />);
    expect((await invoke('showPreset', { preset: 'triage' })).ok).toBe(true);

    const table = screen.getByRole('table', { name: 'Flexible table' });
    const taskRows = [...table.querySelectorAll('tbody tr[data-task-id]')];
    expect(taskRows.map((row) => row.getAttribute('data-task-id'))).toEqual([
      'TL-4',
    ]);
    expect(
      within(taskRows[0] as HTMLElement).getByText('no owner'),
    ).toBeTruthy();
  });

  it('exposes sort direction and priority to assistive technology', async () => {
    render(<FlexibleTableComponent {...tableProps()} />);
    expect(
      (await invoke('sortBy', { column: 'urgency', direction: 'desc' })).ok,
    ).toBe(true);
    expect(
      (
        await invoke('sortBy', {
          column: 'assignee',
          direction: 'asc',
          add: true,
        })
      ).ok,
    ).toBe(true);

    const table = screen.getByRole('table', { name: 'Flexible table' });
    const header = (id: string) =>
      table.querySelector(`th[data-column-id="${id}"]`)!;

    expect(header('urgency').getAttribute('aria-sort')).toBe('descending');
    expect(header('urgency').textContent).toContain(
      'sorted descending, priority 1',
    );
    expect(header('assignee').hasAttribute('aria-sort')).toBe(false);
    expect(header('assignee').textContent).toContain(
      'sorted ascending, priority 2',
    );
    expect(header('title').hasAttribute('aria-sort')).toBe(false);
    expect(header('title').textContent).not.toContain('sorted');
  });
});
