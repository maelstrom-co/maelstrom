import { expect, test } from 'bun:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { CalendarView } from './vessels/calendar.component';
import { JournalView } from './vessels/journal.component';
import { LabsView } from './vessels/labs.component';
import { TasksView } from './vessels/tasks.component';

test('independent app workspaces cannot inherit records or selection through shared renderers', () => {
  const entry = {
    id: 'same-id',
    title: 'First workspace secret',
    date: 'Nov 6',
    content: 'Private note',
  };
  const first = renderToStaticMarkup(
    <JournalView variant="entry" entries={[entry]} activeEntryId={entry.id} />,
  );
  expect(first).toContain('Private note');
  const second = renderToStaticMarkup(
    <JournalView variant="entry" entries={[]} activeEntryId={entry.id} />,
  );
  expect(second).toContain('No entry selected');
  expect(second).not.toContain('Private note');
  expect(
    renderToStaticMarkup(
      <TasksView
        tasks={[
          { id: 'same-id', title: 'Only in first', done: true, subtasks: [] },
        ]}
      />,
    ),
  ).toContain('Only in first');
  expect(renderToStaticMarkup(<TasksView tasks={[]} />)).not.toContain(
    'Only in first',
  );
  expect(
    renderToStaticMarkup(<LabsView variant="trends" marker="glucose" />),
  ).toContain('Glucose');
  expect(
    renderToStaticMarkup(<LabsView variant="trends" marker={null} />),
  ).toContain('None');
});

test('an empty workspace calendar never fabricates events from demo fixtures', () => {
  const html = renderToStaticMarkup(
    <CalendarView variant="week" events={[]} today={new Date(2026, 10, 6)} />,
  );
  expect(html).not.toContain('Design review');
  expect(html).not.toContain('Demo day');
  expect(html).toContain('Nothing scheduled');
  const populated = renderToStaticMarkup(
    <CalendarView
      variant="week"
      events={[]}
      today={new Date(2026, 10, 6)}
      weekEvents={{
        Mon: [{ id: 'appointment', title: 'User appointment', time: '9:30' }],
      }}
    />,
  );
  expect(populated).toContain('User appointment');
});
