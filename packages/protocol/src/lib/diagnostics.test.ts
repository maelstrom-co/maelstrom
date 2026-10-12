import { expect, test } from 'bun:test';
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
