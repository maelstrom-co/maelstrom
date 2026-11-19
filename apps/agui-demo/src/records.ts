import { z } from 'zod';

const title = z.string().trim().min(1).max(200);
const identity = z.string().min(1).max(100);
const version = z.number().int().positive();
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, 'A real calendar date is required.');
export const calendarTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const timeZone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'A supported timezone is required.');

export const RecordsSchema = z.object({
  revision: z.number().int().nonnegative(),
  journal: z
    .array(
      z.object({
        id: identity,
        version,
        title,
        content: z.string().max(100_000),
        date: calendarDate,
      }),
    )
    .max(200),
  tasks: z
    .array(
      z.object({
        id: identity,
        version,
        title,
        done: z.boolean(),
        subtasks: z
          .array(z.object({ id: identity, title, done: z.boolean() }))
          .max(100),
      }),
    )
    .max(200),
  calendar: z
    .array(
      z.object({
        id: identity,
        version,
        title,
        date: calendarDate,
        time: calendarTime,
        timeZone,
      }),
    )
    .max(200),
});
export type Records = z.infer<typeof RecordsSchema>;

const target = z.object({ id: identity, version });
export const RecordCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('journal.create'), title, date: calendarDate }),
  z.object({
    kind: z.literal('journal.append'),
    target,
    text: z.string().min(1).max(20_000),
  }),
  z.object({ kind: z.literal('task.create'), title }),
  z.object({ kind: z.literal('task.remove'), target }),
  z.object({ kind: z.literal('task.check'), target, done: z.boolean() }),
  z.object({ kind: z.literal('task.addSubtask'), target, title }),
  z.object({
    kind: z.literal('calendar.create'),
    title,
    date: calendarDate,
    time: calendarTime,
    timeZone,
  }),
  z.object({ kind: z.literal('calendar.remove'), target }),
  z.object({
    kind: z.literal('calendar.move'),
    target,
    date: calendarDate,
    time: calendarTime,
    timeZone,
  }),
]);
export type RecordCommand = z.infer<typeof RecordCommandSchema>;

export function emptyRecords(): Records {
  return { revision: 0, journal: [], tasks: [], calendar: [] };
}

export function findRecord<
  T extends { id: string; version: number; title: string },
>(records: readonly T[], query: string): T {
  const normalized = title.parse(query).toLocaleLowerCase('en');
  const exact = records.filter(
    (record) => record.title.toLocaleLowerCase('en') === normalized,
  );
  const matches = exact.length
    ? exact
    : records.filter((record) =>
        record.title.toLocaleLowerCase('en').includes(normalized),
      );
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? 'The record title is ambiguous.'
        : 'No record matches that title.',
    );
  return matches[0];
}

function requireVersion<T extends { id: string; version: number }>(
  records: T[],
  expected: z.infer<typeof target>,
): T {
  const record = records.find(({ id }) => id === expected.id);
  if (!record || record.version !== expected.version)
    throw new Error('The record changed. Read it again before writing.');
  return record;
}

export function applyRecordCommand(
  records: Records,
  input: RecordCommand,
  allocate: () => string = () => crypto.randomUUID(),
): { records: Records; recordId: string } {
  const command = RecordCommandSchema.parse(input);
  const next = structuredClone(records);
  let recordId: string;
  switch (command.kind) {
    case 'journal.create':
      recordId = allocate();
      next.journal.unshift({
        id: recordId,
        version: 1,
        title: command.title,
        content: '',
        date: command.date,
      });
      break;
    case 'journal.append': {
      const entry = requireVersion(next.journal, command.target);
      entry.content += (entry.content ? '\n' : '') + command.text;
      entry.version++;
      recordId = entry.id;
      break;
    }
    case 'task.create':
      recordId = allocate();
      next.tasks.push({
        id: recordId,
        version: 1,
        title: command.title,
        done: false,
        subtasks: [],
      });
      break;
    case 'task.remove': {
      recordId = requireVersion(next.tasks, command.target).id;
      next.tasks = next.tasks.filter(({ id }) => id !== recordId);
      break;
    }
    case 'task.check': {
      const task = requireVersion(next.tasks, command.target);
      task.done = command.done;
      task.version++;
      recordId = task.id;
      break;
    }
    case 'task.addSubtask': {
      const task = requireVersion(next.tasks, command.target);
      task.subtasks.push({ id: allocate(), title: command.title, done: false });
      task.version++;
      recordId = task.id;
      break;
    }
    case 'calendar.create':
      recordId = allocate();
      next.calendar.push({
        id: recordId,
        version: 1,
        title: command.title,
        date: command.date,
        time: command.time,
        timeZone: command.timeZone,
      });
      break;
    case 'calendar.remove':
      recordId = requireVersion(next.calendar, command.target).id;
      next.calendar = next.calendar.filter(({ id }) => id !== recordId);
      break;
    case 'calendar.move': {
      const event = requireVersion(next.calendar, command.target);
      event.date = command.date;
      event.time = command.time;
      event.timeZone = command.timeZone;
      event.version++;
      recordId = event.id;
      break;
    }
  }
  next.revision++;
  return { records: RecordsSchema.parse(next), recordId };
}
