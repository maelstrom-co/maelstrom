import { expect, test } from 'bun:test';
import { SessionIdSchema } from './session.js';

test('oversized SDK schema collections fail before application transforms run on their entries', () => {
  let visits = 0;
  const parsed = SessionIdSchema.transform((value) => {
    visits += 1;
    return value;
  })
    .array()
    .max(1)
    .safeParse(['first', 'second']);
  expect(parsed.success).toBe(false);
  expect(visits).toBe(0);
});
