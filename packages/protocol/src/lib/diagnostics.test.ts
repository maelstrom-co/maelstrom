import { expect, test } from 'bun:test';

import { RunId } from './agent-ids.js';
import {
  DiagnosticEventSchema,
  DiagnosticMessageSchema,
} from './diagnostics.js';
import { MessageIdSchema } from './message.js';
import { SessionIdSchema } from './session.js';

test('diagnostics accept the same application identities as the normal protocol', () => {
  const identity = 'x'.repeat(257);
  const event = {
    id: 'event',
    kind: 'client.test',
    at: Date.now(),
    sessionId: SessionIdSchema.parse(identity),
    requestId: MessageIdSchema.parse(identity),
    metadata: {},
  };
  expect(DiagnosticEventSchema.safeParse(event).success).toBe(true);
  expect(
    DiagnosticMessageSchema.safeParse({
      type: 'engine.diagnostics.event',
      event,
    }).success,
  ).toBe(true);
});

const ownedEvent = {
  id: 'event',
  kind: 'engine.fixture',
  at: 1,
  sessionId: 'session',
  metadata: { inputId: 'input-1' },
};

test('a request event validates unchanged', () => {
  const event = { ...ownedEvent, requestId: 'request-1' };
  expect(DiagnosticEventSchema.parse(event)).toEqual(event);
});

test('a run event without a request id validates', () => {
  const event = { ...ownedEvent, runId: RunId('run-1') };
  expect(DiagnosticEventSchema.parse(event)).toEqual(event);
});

test('a session event with neither a request id nor a run id validates', () => {
  expect(DiagnosticEventSchema.parse(ownedEvent)).toEqual(ownedEvent);
});

test('an empty run id is rejected', () => {
  expect(
    DiagnosticEventSchema.safeParse({ ...ownedEvent, runId: '' }).success,
  ).toBe(false);
});
