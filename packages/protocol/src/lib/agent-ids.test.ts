import { describe, expect, test } from 'bun:test';

import {
  CallId,
  CallIdSchema,
  ChangeId,
  ChangeIdSchema,
  RunId,
  RunIdSchema,
} from './agent-ids.js';
import { ToolCallId } from './tool-call-id.js';

const brands = [
  { name: 'RunId', make: RunId, schema: RunIdSchema },
  { name: 'CallId', make: CallId, schema: CallIdSchema },
  { name: 'ChangeId', make: ChangeId, schema: ChangeIdSchema },
] as const;

for (const { name, make, schema } of brands) {
  describe(name, () => {
    test('preserves the provided value when given a non-empty string', () => {
      expect(make('id-1') as string).toBe('id-1');
    });

    test('throws on an empty string', () => {
      expect(() => make('')).toThrow(/non-empty/i);
    });

    test('throws on whitespace-only strings', () => {
      expect(() => make('   ')).toThrow(/non-empty/i);
      expect(() => make('\t')).toThrow(/non-empty/i);
      expect(() => make('\n')).toThrow(/non-empty/i);
    });

    test('names the brand in the constructor error', () => {
      expect(() => make('')).toThrow(name);
    });
  });

  describe(`${name}Schema`, () => {
    test('parses a non-empty string', () => {
      const result = schema.safeParse('id-1');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data as string).toBe('id-1');
    });

    test('rejects empty and whitespace-only strings', () => {
      expect(schema.safeParse('').success).toBe(false);
      expect(schema.safeParse('   ').success).toBe(false);
      expect(schema.safeParse('\t').success).toBe(false);
    });

    test('rejects non-string values', () => {
      expect(schema.safeParse(123).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(false);
      expect(schema.safeParse(undefined).success).toBe(false);
    });
  });
}

describe('agent id brands', () => {
  test('schema output carries the brand', () => {
    const run = RunIdSchema.parse('r-1');
    const call = CallIdSchema.parse('c-1');
    const change = ChangeIdSchema.parse('ch-1');
    const _run: RunId = run;
    const _call: CallId = call;
    const _change: ChangeId = change;
    void [_run, _call, _change];
    expect(true).toBe(true);
  });

  test('type-level: plain strings and sibling brands do not cross-assign', () => {
    const run = RunId('r-1');
    const call = CallId('c-1');
    const change = ChangeId('ch-1');
    const toolCall = ToolCallId('t-1');

    // @ts-expect-error a plain string is not assignable to RunId
    const _r: RunId = 'r-1';
    // @ts-expect-error a plain string is not assignable to CallId
    const _c: CallId = 'c-1';
    // @ts-expect-error a plain string is not assignable to ChangeId
    const _ch: ChangeId = 'ch-1';
    // @ts-expect-error CallId is not assignable to ToolCallId
    const _tc: ToolCallId = call;
    // @ts-expect-error ToolCallId is not assignable to CallId
    const _c2: CallId = toolCall;
    // @ts-expect-error RunId is not assignable to CallId
    const _c3: CallId = run;
    // @ts-expect-error ChangeId is not assignable to RunId
    const _r2: RunId = change;

    void [_r, _c, _ch, _tc, _c2, _c3, _r2];
    expect(true).toBe(true);
  });
});
