import { describe, expect, test } from 'bun:test';

import {
  GridModelOutputSchema,
  GridNeedsClarificationSchema,
  GridResponseWithoutReplySchema,
  MAX_EXECUTION_PLAN_ENTRIES,
  TilingModelOutputSchema,
  TilingNeedsClarificationSchema,
  TilingResponseWithoutReplySchema,
} from '@maelstrom-co/protocol';
import { convertSchemaToJsonSchema } from '@tanstack/ai';

import {
  skipReplyOutputSchemaFor,
  toPlannerOutput,
} from './skip-reply-output.js';

type JsonSchemaObject = {
  type?: unknown;
  anyOf?: unknown;
  oneOf?: unknown;
  required?: string[];
  properties?: Record<string, JsonSchemaObject>;
};

const rawGridOutput = {
  rationale: 'Placed the calendar top left.',
  executionPlan: [
    {
      instanceId: 'calendar-main',
      action: 'setMonth',
      paramsJson: '{"month":3}',
    },
  ],
  layout: {
    positions: [
      {
        instanceId: 'calendar-main',
        position: { row: 0, column: 0 },
        size: { width: 6, height: 4 },
      },
    ],
  },
};

const rawTilingOutput = {
  rationale: 'Split the screen between calendar and notes.',
  executionPlan: [{ instanceId: 'notes-main', action: 'clear' }],
  layout: {
    tree: ['H', 'ID:calendar-main', 'ID:notes-main'],
    instances: [
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
      { instanceId: 'notes-main', vesselId: 'notes', variant: 'list' },
    ],
  },
};

const modes = [
  {
    mode: 'grid' as const,
    modelOutputSchema: GridModelOutputSchema,
    replylessSchema: GridResponseWithoutReplySchema,
    clarificationSchema: GridNeedsClarificationSchema,
    rawOutput: rawGridOutput,
  },
  {
    mode: 'tiling' as const,
    modelOutputSchema: TilingModelOutputSchema,
    replylessSchema: TilingResponseWithoutReplySchema,
    clarificationSchema: TilingNeedsClarificationSchema,
    rawOutput: rawTilingOutput,
  },
];

describe.each(modes)(
  'skipReplyOutputSchemaFor($mode) as structured output',
  ({ mode, modelOutputSchema }) => {
    const jsonSchema = convertSchemaToJsonSchema(
      skipReplyOutputSchemaFor(mode),
    ) as JsonSchemaObject;
    const modelOutputJsonSchema = convertSchemaToJsonSchema(
      modelOutputSchema,
    ) as JsonSchemaObject;

    test('is a single root object with no union', () => {
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.anyOf).toBeUndefined();
      expect(jsonSchema.oneOf).toBeUndefined();
    });

    test('has no userMessage and no type property', () => {
      expect(jsonSchema.properties).not.toHaveProperty('userMessage');
      expect(jsonSchema.properties).not.toHaveProperty('type');
      expect(jsonSchema.required).not.toContain('userMessage');
    });

    test('adds an optional clarification object with no union', () => {
      const clarification = jsonSchema.properties?.clarification;
      expect(clarification?.type).toBe('object');
      expect(clarification?.anyOf).toBeUndefined();
      expect(clarification?.oneOf).toBeUndefined();
      expect(Object.keys(clarification?.properties ?? {}).sort()).toEqual([
        'options',
        'question',
      ]);
      expect(clarification?.required).toEqual(['question']);
      expect(jsonSchema.required).not.toContain('clarification');
    });

    test('keeps every other property identical to the model output schema', () => {
      const { clarification: _clarification, ...planProperties } =
        jsonSchema.properties ?? {};
      const { userMessage: _userMessage, ...expectedProperties } =
        modelOutputJsonSchema.properties ?? {};
      expect(planProperties).toEqual(expectedProperties);
      expect(jsonSchema.required).toEqual(
        modelOutputJsonSchema.required?.filter((key) => key !== 'userMessage'),
      );
    });
  },
);

describe.each(modes)(
  'toPlannerOutput for $mode output',
  ({ mode, replylessSchema, clarificationSchema, rawOutput }) => {
    const schema = skipReplyOutputSchemaFor(mode);

    test('stamps a plan with type plan and no clarification or userMessage key', () => {
      const parsed = schema.parse(rawOutput);
      const result = toPlannerOutput(parsed);

      expect(result).toEqual({ type: 'plan', ...parsed });
      expect(result).not.toHaveProperty('clarification');
      expect(result).not.toHaveProperty('userMessage');
      expect(reparse(replylessSchema, result)).toEqual(result);
    });

    test('maps a clarification with options and carries the partial layout and execution plan', () => {
      const parsed = schema.parse({
        ...rawOutput,
        clarification: {
          question: 'Which share class of Alphabet do you mean?',
          options: ['GOOGL', 'GOOG'],
        },
      });
      const result = toPlannerOutput(parsed);

      expect(result).toEqual({
        type: 'needs_clarification',
        question: 'Which share class of Alphabet do you mean?',
        options: ['GOOGL', 'GOOG'],
        layout: parsed.layout,
        executionPlan: parsed.executionPlan,
      });
      expect(reparse(clarificationSchema, result)).toEqual(result);
    });

    test('maps a clarification without options and omits the options key', () => {
      const parsed = schema.parse({
        ...rawOutput,
        clarification: { question: 'Which month should the calendar show?' },
      });
      const result = toPlannerOutput(parsed);

      expect(result).toEqual({
        type: 'needs_clarification',
        question: 'Which month should the calendar show?',
        layout: parsed.layout,
        executionPlan: parsed.executionPlan,
      });
      expect(result).not.toHaveProperty('options');
      expect(reparse(clarificationSchema, result)).toEqual(result);
    });

    test('maps an unsupported capability clarification that names the gap', () => {
      const parsed = schema.parse({
        ...rawOutput,
        clarification: {
          question:
            'I cannot show a 3D globe. Should I show a flat map or a table of countries instead?',
          options: ['Flat map', 'Table of countries'],
        },
      });
      const result = toPlannerOutput(parsed);

      expect(result).toMatchObject({
        type: 'needs_clarification',
        options: ['Flat map', 'Table of countries'],
        layout: parsed.layout,
        executionPlan: parsed.executionPlan,
      });
      expect(reparse(clarificationSchema, result)).toEqual(result);
    });

    test('keeps an empty execution plan on a clarification that changes nothing yet', () => {
      const parsed = schema.parse({
        ...rawOutput,
        executionPlan: [],
        clarification: { question: 'Which calendar do you mean?' },
      });
      const result = toPlannerOutput(parsed);

      expect(result).toEqual({
        type: 'needs_clarification',
        question: 'Which calendar do you mean?',
        layout: parsed.layout,
        executionPlan: [],
      });
      expect(reparse(clarificationSchema, result)).toEqual(result);
    });

    test('rejects a blank clarification question', () => {
      const result = schema.safeParse({
        ...rawOutput,
        clarification: { question: '   ' },
      });
      expect(result.success).toBe(false);
    });

    test('rejects a blank clarification option', () => {
      const result = schema.safeParse({
        ...rawOutput,
        clarification: { question: 'Which one?', options: ['A', ' '] },
      });
      expect(result.success).toBe(false);
    });

    test('rejects an execution plan over the entry limit', () => {
      const action = rawOutput.executionPlan[0];
      const result = schema.safeParse({
        ...rawOutput,
        executionPlan: Array.from(
          { length: MAX_EXECUTION_PLAN_ENTRIES + 1 },
          () => action,
        ),
        clarification: { question: 'Which one?' },
      });
      expect(result.success).toBe(false);
    });

    test('ignores a userMessage the model writes anyway', () => {
      const parsed = schema.parse({ ...rawOutput, userMessage: 'Done!' });
      expect(toPlannerOutput(parsed)).not.toHaveProperty('userMessage');
    });
  },
);

function reparse(
  schema: { parse: (value: unknown) => unknown },
  value: unknown,
) {
  return schema.parse(value);
}
