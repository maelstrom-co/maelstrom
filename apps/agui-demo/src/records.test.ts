import { expect, test } from 'bun:test';

import {
  applyRecordCommand,
  emptyRecords,
  findRecord,
  RecordCommandSchema,
} from './records';

test('independent workspaces start empty and mutations do not alter an earlier observation', () => {
  const initial = emptyRecords();
  const first = applyRecordCommand(initial, {
    kind: 'journal.create',
    title: 'Private entry',
    date: '2026-11-06',
  });
  expect(initial).toEqual(emptyRecords());
  expect(first.records.journal).toHaveLength(1);
  expect(emptyRecords().journal).toHaveLength(0);
});

test('a stale observed version cannot append content to a changed entry', () => {
  const created = applyRecordCommand(emptyRecords(), {
    kind: 'journal.create',
    title: 'Notes',
    date: '2026-11-06',
  });
  const target = { id: created.recordId, version: 1 };
  const appended = applyRecordCommand(created.records, {
    kind: 'journal.append',
    target,
    text: 'First write',
  });
  expect(() =>
    applyRecordCommand(appended.records, {
      kind: 'journal.append',
      target,
      text: 'Stale write',
    }),
  ).toThrow('changed');
  expect(appended.records.journal[0].content).toBe('First write');
  expect(appended.records.revision).toBe(2);
});

test('calendar records retain their date and timezone instead of moving with today', () => {
  const created = applyRecordCommand(emptyRecords(), {
    kind: 'calendar.create',
    title: 'Appointment',
    date: '2027-02-15',
    time: '10:30',
    timeZone: 'America/Montevideo',
  });
  expect(created.records.calendar[0]).toMatchObject({
    date: '2027-02-15',
    time: '10:30',
    timeZone: 'America/Montevideo',
  });
  const moved = applyRecordCommand(created.records, {
    kind: 'calendar.move',
    target: { id: created.recordId, version: 1 },
    date: '2027-02-16',
    time: '09:00',
    timeZone: 'Europe/Madrid',
  });
  expect(moved.records.calendar[0]).toMatchObject({
    date: '2027-02-16',
    time: '09:00',
    timeZone: 'Europe/Madrid',
    version: 2,
  });
  for (const invalid of [
    { date: '2027-02-30' },
    { time: '24:00' },
    { timeZone: 'Not/AZone' },
  ]) {
    expect(
      RecordCommandSchema.safeParse({
        kind: 'calendar.create',
        title: 'Bad event',
        date: '2027-02-15',
        time: '10:30',
        timeZone: 'UTC',
        ...invalid,
      }).success,
    ).toBe(false);
  }
});

test('ambiguous titles cannot silently select the wrong record for a write', () => {
  const records = [
    { id: 'one', version: 1, title: 'Plan trip' },
    { id: 'two', version: 1, title: 'Plan release' },
  ];
  expect(() => findRecord(records, 'Plan')).toThrow('ambiguous');
  expect(findRecord(records, 'plan trip').id).toBe('one');
});

test('a task mutation preserves its subtasks and rejects stale deletion', () => {
  const created = applyRecordCommand(emptyRecords(), {
    kind: 'task.create',
    title: 'Ship',
  });
  const expanded = applyRecordCommand(created.records, {
    kind: 'task.addSubtask',
    target: { id: created.recordId, version: 1 },
    title: 'Verify',
  });
  const checked = applyRecordCommand(expanded.records, {
    kind: 'task.check',
    target: { id: created.recordId, version: 2 },
    done: true,
  });
  expect(checked.records.tasks[0]).toMatchObject({
    done: true,
    version: 3,
    subtasks: [{ title: 'Verify', done: false }],
  });
  expect(() =>
    applyRecordCommand(checked.records, {
      kind: 'task.remove',
      target: { id: created.recordId, version: 2 },
    }),
  ).toThrow('changed');
});
