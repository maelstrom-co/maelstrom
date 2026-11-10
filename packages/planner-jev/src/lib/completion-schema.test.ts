import { describe, expect, test } from 'bun:test';

import { ActionName, InstanceId } from '@maelstrom-co/protocol';
import { z } from 'zod';

import { outputSchema, type Slot } from './completion-schema.js';

const parameter = {
  name: 'city',
  type: 'string' as const,
  description: 'City to show',
};
const slot: Slot = {
  key: 'p0',
  action: {
    instanceId: InstanceId('weather-main'),
    action: ActionName('focusLocation'),
    params: {},
    pending: [parameter],
  },
  parameter,
};
const layout = z.object({ tree: z.array(z.string()) });

describe('outputSchema', () => {
  test('requires userMessage by default', () => {
    const json = jsonSchema(outputSchema([]));
    expect(Object.keys(json.properties)).toEqual(['userMessage']);
    expect(json.required).toEqual(['userMessage']);
  });

  test('requires userMessage when withMessage is true', () => {
    const json = jsonSchema(outputSchema([], {}, { withMessage: true }));
    expect(json.required).toEqual(['userMessage']);
  });

  test('drops userMessage from properties and required when withMessage is false', () => {
    const json = jsonSchema(outputSchema([], {}, { withMessage: false }));
    expect(json.properties).toEqual({});
    expect(json.required ?? []).toEqual([]);
  });

  test('adds params only when slots exist, with or without the message', () => {
    expect(Object.keys(jsonSchema(outputSchema([slot])).properties)).toEqual([
      'userMessage',
      'params',
    ]);
    const replyless = jsonSchema(
      outputSchema([slot], undefined, { withMessage: false }),
    );
    expect(Object.keys(replyless.properties)).toEqual(['params']);
    expect(replyless.required).toEqual(['params']);
    expect(replyless.properties.params).toEqual(
      jsonSchema(outputSchema([slot])).properties.params,
    );
  });

  test('types params values from the slot parameter as nullable', () => {
    const schema = outputSchema([slot], {}, { withMessage: false });
    expect(schema.safeParse({ params: { p0: null } }).success).toBe(true);
    expect(schema.safeParse({ params: { p0: 'Paris' } }).success).toBe(true);
    expect(schema.safeParse({ params: { p0: 3 } }).success).toBe(false);
  });

  test('merges extra fields when the message is omitted', () => {
    const json = jsonSchema(
      outputSchema([slot], { layout }, { withMessage: false }),
    );
    expect(Object.keys(json.properties)).toEqual(['params', 'layout']);
    expect(json.required).toEqual(['params', 'layout']);
  });

  test('merges extra fields after userMessage by default', () => {
    expect(
      Object.keys(jsonSchema(outputSchema([], { layout })).properties),
    ).toEqual(['userMessage', 'layout']);
  });

  test('rejects a missing userMessage only when it is requested', () => {
    expect(outputSchema([]).safeParse({}).success).toBe(false);
    expect(
      outputSchema([], {}, { withMessage: false }).safeParse({}).success,
    ).toBe(true);
  });
});

type ObjectJsonSchema = {
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
};

function jsonSchema(schema: z.ZodType): ObjectJsonSchema {
  return z.toJSONSchema(schema) as unknown as ObjectJsonSchema;
}
