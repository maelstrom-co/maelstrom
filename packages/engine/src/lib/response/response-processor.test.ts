import { describe, expect, test } from 'bun:test';
import { InstanceId, isErr, isOk } from '@maelstrom-co/protocol';
import type { GridResponse, TilingResponse } from '@maelstrom-co/protocol-old';
import type { Logger } from '../logger.js';
import { processResponse } from './response-processor.js';
import {
  makeGridRequest,
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processResponse', () => {
  describe('grid mode', () => {
    test('builds a valid MaelstromResponse', () => {
      const llmOutput: GridResponse = {
        userMessage: 'Here is your calendar!',
        rationale: 'User asked for calendar',
        executionPlan: [],
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

      const result = processResponse(
        llmOutput,
        makeGridRequest(),
        silentLogger,
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.type).toBe('maelstrom_response');
      expect(result.value.requestId).toBe('req-1');
      expect(result.value.userMessage).toBe('Here is your calendar!');
      expect(result.value.rationale).toBe('User asked for calendar');
      expect(result.value.layout.type).toBe('grid');
      expect(result.value.executionPlan).toEqual([]);
    });
  });

  describe('tiling mode', () => {
    test('builds a valid MaelstromResponse with tiling layout', () => {
      const llmOutput: TilingResponse = {
        userMessage: 'Showing calendar',
        rationale: 'Display the calendar',
        executionPlan: [],
        layout: {
          tree: ['calendar-main'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
          ],
        },
      };

      const result = processResponse(
        llmOutput,
        makeTilingRequest(),
        silentLogger,
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.layout.type).toBe('tiling');
      if (result.value.layout.type === 'tiling') {
        expect(result.value.layout.tree).toEqual([InstanceId('calendar-main')]);
      }
    });

    test('parses execution plan from a tiling request', () => {
      const llmOutput: TilingResponse = {
        userMessage: 'Switching calendar view',
        rationale: 'User asked for week view',
        executionPlan: [
          { instanceId: 'calendar-main', action: 'showWeek' },
        ],
        layout: {
          tree: ['calendar-main'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
          ],
        },
      };

      const request = makeTilingRequest({
        vessels: [
          {
            id: 'calendar',
            name: 'Calendar',
            description: 'Calendar widget',
            defaultVariant: 'month',
            variants: {
              month: {
                props: {},
                minSize: { width: 4, height: 4 },
                actions: [
                  {
                    name: 'showWeek',
                    description: 'Show week',
                    transitionsTo: 'week',
                  },
                ],
              },
            },
          },
        ],
      });

      const result = processResponse(llmOutput, request, silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(1);
      expect(result.value.executionPlan[0]).toEqual({
        instanceId: InstanceId('calendar-main'),
        action: 'showWeek',
      });
    });
  });

  describe('execution plan parsing', () => {
    const richRequest = () =>
      makeGridRequest({
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
          {
            instanceId: 'orders-main',
            vesselId: 'orders',
            variant: 'list',
          },
          { instanceId: 'a', vesselId: 'widget', variant: 'default' },
          { instanceId: 'b', vesselId: 'widget', variant: 'default' },
        ],
        vessels: [
          {
            id: 'calendar',
            name: 'Calendar',
            description: 'Calendar widget',
            defaultVariant: 'month',
            variants: {
              month: {
                props: {},
                minSize: { width: 4, height: 4 },
                actions: [
                  {
                    name: 'showWeek',
                    description: 'Week view',
                    transitionsTo: 'week',
                  },
                ],
              },
              week: {
                props: {},
                minSize: { width: 6, height: 4 },
                actions: [],
              },
            },
          },
          {
            id: 'orders',
            name: 'Orders',
            description: 'Order management',
            defaultVariant: 'list',
            variants: {
              list: {
                props: {},
                minSize: { width: 4, height: 4 },
                actions: [
                  {
                    name: 'selectOrder',
                    description: 'Select an order',
                    parameters: [
                      {
                        name: 'orderId',
                        type: 'string',
                        description: 'The order ID',
                        required: true,
                      },
                    ],
                  },
                ],
              },
            },
          },
          {
            id: 'widget',
            name: 'Widget',
            description: 'Generic widget',
            defaultVariant: 'default',
            variants: {
              default: {
                props: {},
                minSize: { width: 2, height: 2 },
                actions: [
                  { name: 'first', description: 'First action' },
                  {
                    name: 'second',
                    description: 'Second action',
                    parameters: [
                      {
                        name: 'x',
                        type: 'number',
                        description: 'X param',
                      },
                    ],
                  },
                  { name: 'third', description: 'Third action' },
                  { name: 'doIt', description: 'Do it action' },
                ],
              },
            },
          },
        ],
      });

    test('parses paramsJson into params', () => {
      const llmOutput: GridResponse = {
        userMessage: 'Opening order',
        rationale: 'User wants details',
        executionPlan: [
          {
            instanceId: 'orders-main',
            action: 'selectOrder',
            paramsJson: '{"orderId":"abc-123"}',
          },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, richRequest(), silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(1);
      const action = result.value.executionPlan[0];
      expect(action.instanceId).toBe(InstanceId('orders-main'));
      expect(action.action).toBe('selectOrder');
      expect(action.params).toEqual({ orderId: 'abc-123' });
    });

    test('handles action without paramsJson', () => {
      const llmOutput: GridResponse = {
        userMessage: 'Switching view',
        rationale: 'Simple transition',
        executionPlan: [{ instanceId: 'calendar-main', action: 'showWeek' }],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, richRequest(), silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan[0]).toEqual({
        instanceId: InstanceId('calendar-main'),
        action: 'showWeek',
      });
    });

    test('skips action entirely when paramsJson is invalid JSON', () => {
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (msg: string) => errors.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Trying action',
        rationale: 'Test',
        executionPlan: [
          {
            instanceId: 'a',
            action: 'doIt',
            paramsJson: '{invalid json}',
          },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, richRequest(), logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Failed to parse paramsJson');
    });

    test('handles multiple actions in execution plan', () => {
      const llmOutput: GridResponse = {
        userMessage: 'Multiple actions',
        rationale: 'Chained',
        executionPlan: [
          { instanceId: 'a', action: 'first' },
          { instanceId: 'b', action: 'second', paramsJson: '{"x":1}' },
          { instanceId: 'a', action: 'third' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, richRequest(), silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(3);
      const second = result.value.executionPlan[1];
      expect(second.params).toEqual({ x: 1 });
    });

    test('skips action when paramsJson is a number', () => {
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (msg: string) => errors.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Action test',
        rationale: 'Test',
        executionPlan: [{ instanceId: 'a', action: 'doIt', paramsJson: '42' }],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, richRequest(), logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(0);
      expect(errors[0]).toContain('not a JSON object');
    });

    test('skips action when paramsJson is a string', () => {
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (msg: string) => errors.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Action test',
        rationale: 'Test',
        executionPlan: [
          { instanceId: 'a', action: 'doIt', paramsJson: '"hello"' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, richRequest(), logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(0);
      expect(errors[0]).toContain('not a JSON object');
    });

    test('skips action when paramsJson is an array', () => {
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (msg: string) => errors.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Action test',
        rationale: 'Test',
        executionPlan: [
          { instanceId: 'a', action: 'doIt', paramsJson: '[1,2,3]' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, richRequest(), logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(0);
      expect(errors[0]).toContain('not a JSON object');
    });

    test('skips action when paramsJson is null', () => {
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (msg: string) => errors.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Action test',
        rationale: 'Test',
        executionPlan: [
          { instanceId: 'a', action: 'doIt', paramsJson: 'null' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, richRequest(), logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(0);
      expect(errors[0]).toContain('not a JSON object');
    });
  });

  describe('execution plan validation', () => {
    test('skips action referencing unknown instanceId', () => {
      const warnings: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        warn: (msg: string) => warnings.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Doing something',
        rationale: 'Test',
        executionPlan: [{ instanceId: 'nonexistent', action: 'showWeek' }],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, makeGridRequest(), logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('unknown instanceId');
      expect(warnings[0]).toContain('nonexistent');
    });

    test('skips action not valid for current variant', () => {
      const warnings: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        warn: (msg: string) => warnings.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Invalid action',
        rationale: 'Test',
        executionPlan: [
          { instanceId: 'calendar-main', action: 'nonexistentAction' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, makeGridRequest(), logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('nonexistentAction');
      expect(warnings[0]).toContain('not valid');
    });

    test('passes through action valid for current variant', () => {
      const llmOutput: GridResponse = {
        userMessage: 'Week view',
        rationale: 'Test',
        executionPlan: [{ instanceId: 'calendar-main', action: 'showWeek' }],
        layout: { positions: [] },
      };

      const result = processResponse(
        llmOutput,
        makeGridRequest(),
        silentLogger,
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(1);
      expect(result.value.executionPlan[0].action).toBe('showWeek');
    });

    test('includes valid actions from list, warns about invalid actions from the same list', () => {
      const warnings: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        warn: (msg: string) => warnings.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Mixed',
        rationale: 'Test',
        executionPlan: [
          { instanceId: 'calendar-main', action: 'showWeek' },
          { instanceId: 'calendar-main', action: 'bogusAction' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, makeGridRequest(), logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(1);
      expect(result.value.executionPlan[0].action).toBe('showWeek');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('bogusAction');
    });
  });

  describe('validation', () => {
    test('returns ParseError when userMessage is whitespace-only', () => {
      const llmOutput: GridResponse = {
        userMessage: '   ',
        rationale: 'Whitespace',
        executionPlan: [],
        layout: { positions: [] },
      };

      const result = processResponse(
        llmOutput,
        makeGridRequest(),
        silentLogger,
      );
      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;

      expect(result.error._tag).toBe('ParseError');
      expect(result.error.message).toContain('userMessage');
    });

    test('returns ParseError when userMessage is empty', () => {
      const llmOutput: GridResponse = {
        userMessage: '',
        rationale: 'No message',
        executionPlan: [],
        layout: { positions: [] },
      };

      const result = processResponse(
        llmOutput,
        makeGridRequest(),
        silentLogger,
      );
      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;

      expect(result.error._tag).toBe('ParseError');
      expect(result.error.message).toContain('userMessage');
    });
  });
});
