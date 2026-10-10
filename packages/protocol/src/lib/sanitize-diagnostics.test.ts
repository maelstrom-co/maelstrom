import { expect, test } from 'bun:test';
import { DiagnosticEventSchema } from './diagnostics.js';
import { sanitizeDiagnosticValue } from './sanitize-diagnostics.js';

test('redactors cannot mutate live application data and getters cannot run during projection', () => {
  const original = {
    value: 'business',
    apiKey: 'private',
    nested: { value: 1 },
  };
  let getterRan = false;
  Object.defineProperty(original, 'unexpected', {
    enumerable: true,
    get: () => {
      getterRan = true;
      throw new Error('getter executed');
    },
  });
  const clean = sanitizeDiagnosticValue(original, {
    redact: (value) => {
      const copy = value as typeof original;
      copy.nested.value = 2;
      return copy;
    },
  });
  expect(original.nested.value).toBe(1);
  expect(getterRan).toBe(false);
  expect(clean).toMatchObject({ apiKey: '[REDACTED]', nested: { value: 2 } });
});

test('omits absent optional fields so a diagnostic capture can be decoded again', () => {
  expect(
    sanitizeDiagnosticValue({ requestId: undefined, metadata: { count: 1 } }),
  ).toEqual({ metadata: { count: 1 } });
});

test.each([
  1, 8, 16384,
])('truncation stays inside the configured string bound of %s', (limit) => {
  const result = sanitizeDiagnosticValue('x'.repeat(limit + 1), {
    maxStringCharacters: limit,
  });
  expect(typeof result).toBe('string');
  expect((result as string).length).toBeLessThanOrEqual(limit);
});

test('long metadata remains a valid diagnostic event after truncation', () => {
  const result = sanitizeDiagnosticValue({
    id: 'event',
    kind: 'client.test',
    at: Date.now(),
    sessionId: 'session',
    metadata: { label: 'x'.repeat(16385) },
  });
  expect(DiagnosticEventSchema.safeParse(result).success).toBe(true);
});

test('truncation also respects the remaining projection budget', () => {
  const result = sanitizeDiagnosticValue('x'.repeat(100), { maxCharacters: 8 });
  expect((result as string).length).toBeLessThanOrEqual(8);
});

test('credential markers respect small configured string bounds', () => {
  const result = sanitizeDiagnosticValue(
    { token: 'private' },
    { maxStringCharacters: 1 },
  ) as { token: string };
  expect(result.token.length).toBeLessThanOrEqual(1);
  expect(JSON.stringify(result)).not.toContain('private');
});
