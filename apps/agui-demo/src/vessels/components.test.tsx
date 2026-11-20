import { expect, test } from 'bun:test';

import { InstanceId } from '@maelstrom-co/protocol';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { WorkspaceConnector } from '../browser/workspace-connector';
import { WorkspaceContext, WorkspaceState } from '../browser/workspace-state';
import { Calendar } from './components';

test('week columns show appointments chronologically even when another day is selected', async () => {
  const window = new Window();
  window.document.body.innerHTML = '<div id="root"></div>';
  const globals = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = window.document.getElementById('root')!;
  const root = createRoot(container as unknown as HTMLElement);
  const state = new WorkspaceState(
    {
      revision: 1,
      journal: [],
      tasks: [],
      calendar: [
        {
          id: 'afternoon',
          version: 1,
          title: 'Afternoon appointment',
          date: '2026-11-09',
          time: '14:00',
          timeZone: 'UTC',
        },
        {
          id: 'morning',
          version: 1,
          title: 'Morning appointment',
          date: '2026-11-09',
          time: '09:00',
          timeZone: 'UTC',
        },
      ],
    },
    new WorkspaceConnector(async () => []),
    async () => {
      throw new Error('Rendering must not request an operation.');
    },
  );
  state.update({ calendarDate: '2026-11-10' });
  try {
    await act(async () => {
      root.render(
        <WorkspaceContext value={state}>
          <Calendar
            instanceId={InstanceId('calendar')}
            variantProps={{ variant: 'week' }}
            executeAction={() => undefined}
          />
        </WorkspaceContext>,
      );
    });
    const text = container.textContent!;
    expect(text).toContain('Morning appointment');
    expect(text).toContain('Afternoon appointment');
    expect(text.indexOf('Morning appointment')).toBeLessThan(
      text.indexOf('Afternoon appointment'),
    );
    expect(state.snapshot().records.calendar.map(({ id }) => id)).toEqual([
      'afternoon',
      'morning',
    ]);
  } finally {
    await act(async () => root.unmount());
    state.dispose();
    await window.happyDOM.close();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (globals[key]) Object.defineProperty(globalThis, key, globals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
