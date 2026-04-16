import { describe, expect, test } from 'bun:test';
import { InstanceId, isErr, isOk } from '@maelstrom-co/protocol';
import type {
  ChartRequest,
  GridResponse,
  TilingResponse,
  Vessel,
} from '@maelstrom-co/protocol-old';
import {
  makeGridRequest,
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import type { Logger } from '../logger.js';
import { processResponse } from './response-processor.js';

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
        executionPlan: [{ instanceId: 'calendar-main', action: 'showWeek' }],
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
              week: {
                props: {},
                minSize: { width: 6, height: 4 },
                actions: [],
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

    test('skips invalid action in tiling mode and records diagnostic', () => {
      // Symmetry check: simulation and validation are layout-mode-agnostic.
      // An invalid action in tiling mode must drop, warn, and diagnose
      // identically to grid mode.
      const warnings: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        warn: (msg: string) => warnings.push(msg),
      };

      const request: ChartRequest = {
        type: 'chart_request',
        id: 'req-tiling-skip',
        context: {
          updateReasons: [{ type: 'user_intent', intent: 'Try bad action' }],
          chartDimensions: { columns: 12, rows: 8 },
          timestamp: Date.now(),
          sessionId: 'session-tiling-skip',
          layoutMode: 'tiling',
        },
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
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
                actions: [{ name: 'showWeek', description: 'Week view' }],
              },
            },
          },
        ],
        layout: {
          type: 'tiling',
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

      const llmOutput: TilingResponse = {
        userMessage: 'Invalid action in tiling',
        rationale: 'Drops are layout-mode-agnostic',
        executionPlan: [
          { instanceId: 'calendar-main', action: 'doesNotExist' },
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

      const result = processResponse(llmOutput, request, logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(0);
      expect(result.value.layout.type).toBe('tiling');
      expect(warnings.some((w) => w.includes('not valid'))).toBe(true);
      expect(result.value.diagnostics.skippedActions).toHaveLength(1);
      expect(result.value.diagnostics.skippedActions[0].reason).toBe(
        'action_not_valid',
      );
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

    test.each([
      ['number', '42'],
      ['string', '"hello"'],
      ['array', '[1,2,3]'],
      ['null', 'null'],
    ])('skips action when paramsJson is a valid JSON %s (not an object)', (_label, paramsJson) => {
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (msg: string) => errors.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Action test',
        rationale: 'Test',
        executionPlan: [{ instanceId: 'a', action: 'doIt', paramsJson }],
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

  describe('variant state simulation', () => {
    // Create a vessel with a multi-variant state machine for testing sequential transitions
    const multiStateVessel = (): Vessel => ({
      id: 'widget',
      name: 'Widget',
      description: 'Multi-state widget for testing',
      defaultVariant: 'compact',
      variants: {
        compact: {
          props: {},
          minSize: { width: 2, height: 2 },
          actions: [
            {
              name: 'expand',
              description: 'Expand to full view',
              transitionsTo: 'expanded',
            },
            {
              name: 'minimize',
              description: 'Minimize to icon',
              transitionsTo: 'icon',
            },
          ],
        },
        expanded: {
          props: {},
          minSize: { width: 6, height: 4 },
          actions: [
            {
              name: 'collapse',
              description: 'Collapse to compact',
              transitionsTo: 'compact',
            },
            {
              name: 'maximize',
              description: 'Maximize to full screen',
              transitionsTo: 'fullscreen',
            },
          ],
        },
        fullscreen: {
          props: {},
          minSize: { width: 12, height: 8 },
          actions: [
            {
              name: 'restore',
              description: 'Restore from fullscreen',
              transitionsTo: 'expanded',
            },
          ],
        },
        icon: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: 'restore',
              description: 'Restore from icon',
              transitionsTo: 'compact',
            },
          ],
        },
      },
    });

    const makeMultiStateRequest = (initialVariant: string): ChartRequest =>
      makeGridRequest({
        instances: [
          {
            instanceId: 'widget-1',
            vesselId: 'widget',
            variant: initialVariant,
          },
        ],
        vessels: [multiStateVessel()],
      });

    // Helper for tiling request with custom instances/vessels
    const makeTilingRequest = (
      overrides?: Partial<Pick<ChartRequest, 'instances' | 'vessels'>>,
    ): ChartRequest => ({
      type: 'chart_request',
      id: 'req-tiling',
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'Test' }],
        chartDimensions: { columns: 12, rows: 8 },
        timestamp: Date.now(),
        sessionId: 'session-tiling',
        layoutMode: 'tiling',
      },
      instances: overrides?.instances ?? [
        { instanceId: 'widget-1', vesselId: 'widget', variant: 'compact' },
      ],
      vessels: overrides?.vessels ?? [multiStateVessel()],
      layout: {
        type: 'tiling',
        tree: ['widget-1'],
        instances: [
          { instanceId: 'widget-1', vesselId: 'widget', variant: 'compact' },
        ],
      },
    });

    test('accepts valid sequential action transitions', () => {
      // compact -> expand -> collapse (should all be valid)
      const llmOutput: GridResponse = {
        userMessage: 'Managing widget state',
        rationale: 'Sequential transitions',
        executionPlan: [
          { instanceId: 'widget-1', action: 'expand' },
          { instanceId: 'widget-1', action: 'collapse' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(
        llmOutput,
        makeMultiStateRequest('compact'),
        silentLogger,
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // Both actions should be accepted
      expect(result.value.executionPlan).toHaveLength(2);
      expect(result.value.executionPlan[0].action).toBe('expand');
      expect(result.value.executionPlan[1].action).toBe('collapse');
    });

    test('accepts three-step sequential transitions', () => {
      // compact -> expand -> maximize -> restore
      const llmOutput: GridResponse = {
        userMessage: 'Multi-step transition',
        rationale: 'Three sequential transitions',
        executionPlan: [
          { instanceId: 'widget-1', action: 'expand' },
          { instanceId: 'widget-1', action: 'maximize' },
          { instanceId: 'widget-1', action: 'restore' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(
        llmOutput,
        makeMultiStateRequest('compact'),
        silentLogger,
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(3);
      expect(result.value.executionPlan[0].action).toBe('expand');
      expect(result.value.executionPlan[1].action).toBe('maximize');
      expect(result.value.executionPlan[2].action).toBe('restore');
    });

    test('skips action that is invalid in simulated variant state', () => {
      const warnings: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        warn: (msg: string) => warnings.push(msg),
      };

      // compact -> expand (valid), then expand again (invalid - already in expanded)
      const llmOutput: GridResponse = {
        userMessage: 'Invalid sequence',
        rationale: 'Trying expand after already expanded',
        executionPlan: [
          { instanceId: 'widget-1', action: 'expand' },
          { instanceId: 'widget-1', action: 'expand' }, // invalid in 'expanded'
        ],
        layout: { positions: [] },
      };

      const result = processResponse(
        llmOutput,
        makeMultiStateRequest('compact'),
        logger,
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // Only first expand should be accepted
      expect(result.value.executionPlan).toHaveLength(1);
      expect(result.value.executionPlan[0].action).toBe('expand');

      // Single per-action warning (no aggregate noise)
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('expand');
      expect(warnings[0]).toContain('expanded');
      expect(warnings[0]).toContain('not valid');
    });

    test('handles multi-step transitions across non-consecutive actions', () => {
      const request = makeGridRequest({
        instances: [
          {
            instanceId: 'widget-a',
            vesselId: 'widget',
            variant: 'compact',
          },
          {
            instanceId: 'widget-b',
            vesselId: 'widget',
            variant: 'compact',
          },
        ],
        vessels: [multiStateVessel()],
      });

      // Interleaved actions: A expands, B expands, A collapses, B maximizes
      const llmOutput: GridResponse = {
        userMessage: 'Interleaved transitions',
        rationale: 'Non-consecutive actions on same instance',
        executionPlan: [
          { instanceId: 'widget-a', action: 'expand' },
          { instanceId: 'widget-b', action: 'expand' },
          { instanceId: 'widget-a', action: 'collapse' },
          { instanceId: 'widget-b', action: 'maximize' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // All actions should be valid:
      // A: compact -> expanded -> compact
      // B: compact -> expanded -> fullscreen
      expect(result.value.executionPlan).toHaveLength(4);
      expect(result.value.executionPlan[0]).toEqual({
        instanceId: InstanceId('widget-a'),
        action: 'expand',
      });
      expect(result.value.executionPlan[1]).toEqual({
        instanceId: InstanceId('widget-b'),
        action: 'expand',
      });
      expect(result.value.executionPlan[2]).toEqual({
        instanceId: InstanceId('widget-a'),
        action: 'collapse',
      });
      expect(result.value.executionPlan[3]).toEqual({
        instanceId: InstanceId('widget-b'),
        action: 'maximize',
      });
    });

    test('skips invalid interleaved actions with warnings', () => {
      const warnings: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        warn: (msg: string) => warnings.push(msg),
      };

      const request = makeGridRequest({
        instances: [
          {
            instanceId: 'widget-a',
            vesselId: 'widget',
            variant: 'compact',
          },
          {
            instanceId: 'widget-b',
            vesselId: 'widget',
            variant: 'compact',
          },
        ],
        vessels: [multiStateVessel()],
      });

      // Mix valid and invalid: A expands, A expands (invalid), B expands, A collapse (valid after skip)
      const llmOutput: GridResponse = {
        userMessage: 'Mixed valid and invalid',
        rationale: 'Some invalid interleaved actions',
        executionPlan: [
          { instanceId: 'widget-a', action: 'expand' },
          { instanceId: 'widget-a', action: 'expand' }, // invalid
          { instanceId: 'widget-b', action: 'expand' },
          { instanceId: 'widget-a', action: 'collapse' }, // valid
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // Should have 3 valid actions (expand, expand, collapse)
      expect(result.value.executionPlan).toHaveLength(3);
      expect(result.value.executionPlan[0].action).toBe('expand');
      expect(result.value.executionPlan[0].instanceId).toBe(
        InstanceId('widget-a'),
      );
      expect(result.value.executionPlan[1].action).toBe('expand');
      expect(result.value.executionPlan[1].instanceId).toBe(
        InstanceId('widget-b'),
      );
      expect(result.value.executionPlan[2].action).toBe('collapse');
      expect(result.value.executionPlan[2].instanceId).toBe(
        InstanceId('widget-a'),
      );

      // Single per-action warning (no aggregate noise)
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('expand');
      expect(warnings[0]).toContain('expanded');
    });

    test('logs debug message when simulating variant transition', () => {
      const debugMessages: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        debug: (msg: string) => debugMessages.push(msg),
      };

      const llmOutput: GridResponse = {
        userMessage: 'Transition test',
        rationale: 'Testing debug logging',
        executionPlan: [{ instanceId: 'widget-1', action: 'expand' }],
        layout: { positions: [] },
      };

      const result = processResponse(
        llmOutput,
        makeMultiStateRequest('compact'),
        logger,
      );
      expect(isOk(result)).toBe(true);

      // Should log the variant transition
      expect(debugMessages).toHaveLength(1);
      expect(debugMessages[0]).toContain('Simulated variant transition');
      expect(debugMessages[0]).toContain('compact');
      expect(debugMessages[0]).toContain('expanded');
    });

    test('drops action when transition target has gone missing from vessel', () => {
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (msg: string) => errors.push(msg),
      };

      const vesselWithBadTransition: Vessel = {
        id: 'bad-widget',
        name: 'Bad Widget',
        description: 'Has a transition to non-existent variant',
        defaultVariant: 'start',
        variants: {
          start: {
            props: {},
            minSize: { width: 2, height: 2 },
            actions: [
              {
                name: 'badAction',
                description: 'Transitions to non-existent variant',
                transitionsTo: 'nonexistent',
              },
            ],
          },
        },
      };

      const request = makeGridRequest({
        instances: [
          { instanceId: 'bad-1', vesselId: 'bad-widget', variant: 'start' },
        ],
        vessels: [vesselWithBadTransition],
      });

      const llmOutput: GridResponse = {
        userMessage: 'Bad transition',
        rationale: 'Testing non-existent variant target',
        executionPlan: [{ instanceId: 'bad-1', action: 'badAction' }],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // Action is dropped so the runtime never attempts the impossible transition.
      expect(result.value.executionPlan).toHaveLength(0);

      // VesselSchema rejects this statically, so the only way to reach this
      // branch at runtime is live vessel mutation — the error must name
      // state drift, not a static definition bug.
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Vessel state drift');
      expect(errors[0]).toContain('nonexistent');
      expect(errors[0]).toContain('dropping action');

      // Diagnostics surface the dropped action for the retry pipeline.
      const skipped = result.value.diagnostics.skippedActions;
      expect(skipped).toHaveLength(1);
      expect(skipped[0].reason).toBe('state_drift');
      expect(skipped[0].detail).toBe(
        'targetVariant=nonexistent, vesselId=bad-widget',
      );
    });

    test('works correctly in tiling mode', () => {
      const request = makeTilingRequest({
        instances: [
          {
            instanceId: 'widget-1',
            vesselId: 'widget',
            variant: 'compact',
          },
        ],
        vessels: [multiStateVessel()],
      });

      const llmOutput: TilingResponse = {
        userMessage: 'Tiling transition',
        rationale: 'Sequential transitions in tiling mode',
        executionPlan: [
          { instanceId: 'widget-1', action: 'expand' },
          { instanceId: 'widget-1', action: 'maximize' },
        ],
        layout: {
          tree: ['widget-1'],
          instances: [
            {
              instanceId: 'widget-1',
              vesselId: 'widget',
              variant: 'fullscreen',
            },
          ],
        },
      };

      const result = processResponse(llmOutput, request, silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.executionPlan).toHaveLength(2);
      expect(result.value.executionPlan[0].action).toBe('expand');
      expect(result.value.executionPlan[1].action).toBe('maximize');
      expect(result.value.layout.type).toBe('tiling');
    });

    test('skips action when instance references unknown vesselId', () => {
      const warnings: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        warn: (msg: string) => warnings.push(msg),
      };

      // Instance references a vesselId that has no matching vessel definition
      const request = makeGridRequest({
        instances: [
          {
            instanceId: 'orphan-1',
            vesselId: 'does-not-exist',
            variant: 'compact',
          },
          {
            instanceId: 'widget-1',
            vesselId: 'widget',
            variant: 'compact',
          },
        ],
        vessels: [multiStateVessel()],
      });

      const llmOutput: GridResponse = {
        userMessage: 'Unknown vessel',
        rationale: 'Testing unknown vesselId',
        executionPlan: [
          { instanceId: 'orphan-1', action: 'expand' },
          { instanceId: 'widget-1', action: 'expand' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // Only the valid action on widget-1 should be accepted
      expect(result.value.executionPlan).toHaveLength(1);
      expect(result.value.executionPlan[0].instanceId).toBe(
        InstanceId('widget-1'),
      );

      // Should warn about unknown vesselId
      expect(warnings.some((w) => w.includes('unknown vesselId'))).toBe(true);

      // Diagnostic captures the structured reason for the retry pipeline.
      expect(result.value.diagnostics.skippedActions).toHaveLength(1);
      expect(result.value.diagnostics.skippedActions[0].reason).toBe(
        'unknown_vessel',
      );
      expect(result.value.diagnostics.skippedActions[0].detail).toContain(
        'does-not-exist',
      );
    });

    test('skips action when instance variant does not exist in vessel definition', () => {
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (msg: string) => errors.push(msg),
      };

      // Instance's variant field does not match any variant in the vessel
      const request = makeGridRequest({
        instances: [
          {
            instanceId: 'widget-1',
            vesselId: 'widget',
            variant: 'deleted-variant',
          },
        ],
        vessels: [multiStateVessel()],
      });

      const llmOutput: GridResponse = {
        userMessage: 'Bad variant',
        rationale: 'Testing non-existent variant on instance',
        executionPlan: [{ instanceId: 'widget-1', action: 'expand' }],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // Action should be skipped
      expect(result.value.executionPlan).toHaveLength(0);

      // State drift is logged at error severity (not warn) so operators can
      // group it with the matching drift error from updateSimulatedVariant
      // when filtering log aggregators by severity.
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Vessel state drift');
      expect(errors[0]).toContain('widget-1');
      expect(errors[0]).toContain('deleted-variant');

      // Diagnostic captures the structured reason for the retry pipeline.
      expect(result.value.diagnostics.skippedActions).toHaveLength(1);
      expect(result.value.diagnostics.skippedActions[0].reason).toBe(
        'variant_not_on_vessel',
      );
      expect(result.value.diagnostics.skippedActions[0].detail).toContain(
        'deleted-variant',
      );
    });

    test('drops drifted action but keeps subsequent actions validating against original variant', () => {
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (msg: string) => errors.push(msg),
      };

      const vesselWithBadAndGoodActions: Vessel = {
        id: 'test-widget',
        name: 'Test Widget',
        description: 'Has both a bad transition and a valid action',
        defaultVariant: 'start',
        variants: {
          start: {
            props: {},
            minSize: { width: 2, height: 2 },
            actions: [
              {
                name: 'badTransition',
                description: 'Transitions to non-existent variant',
                transitionsTo: 'nonexistent',
              },
              {
                name: 'goodAction',
                description: 'A valid action with no transition',
              },
            ],
          },
        },
      };

      const request = makeGridRequest({
        instances: [
          {
            instanceId: 'tw-1',
            vesselId: 'test-widget',
            variant: 'start',
          },
        ],
        vessels: [vesselWithBadAndGoodActions],
      });

      // badTransition resolves cleanly but its target variant is missing —
      // engine drops it so the runtime never attempts an impossible transition.
      // goodAction must still validate against 'start' (the pre-drop variant).
      const llmOutput: GridResponse = {
        userMessage: 'After bad transition',
        rationale: 'Testing variant state after failed transition',
        executionPlan: [
          { instanceId: 'tw-1', action: 'badTransition' },
          { instanceId: 'tw-1', action: 'goodAction' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, logger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // Only goodAction survives — badTransition is dropped pre-emptively
      // rather than handed to the runtime to crash on.
      expect(result.value.executionPlan).toHaveLength(1);
      expect(result.value.executionPlan[0].action).toBe('goodAction');

      // state_drift diagnostic captures the dropped action with structured detail
      const skipped = result.value.diagnostics.skippedActions;
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toEqual({
        instanceId: 'tw-1',
        action: 'badTransition',
        reason: 'state_drift',
        detail: 'targetVariant=nonexistent, vesselId=test-widget',
      });

      // Should have logged an error about the bad transition target
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Vessel state drift');
      expect(errors[0]).toContain('dropping action');
    });

    test('duplicate instanceId in request.instances resolves against last-wins', () => {
      // parseExecutionPlan builds instanceMap via new Map(...). If two
      // instances share an instanceId, the second silently overwrites the
      // first — resolveAction then validates against the second entry's
      // vessel/variant. Pins the current contract; if duplicate rejection
      // is ever added, this test flips to a failure and a new test
      // replaces it.
      const vesselA: Vessel = {
        id: 'a',
        name: 'A',
        description: 'Vessel A',
        defaultVariant: 'only',
        variants: {
          only: {
            props: {},
            minSize: { width: 2, height: 2 },
            actions: [{ name: 'onA', description: 'Valid on A' }],
          },
        },
      };
      const vesselB: Vessel = {
        id: 'b',
        name: 'B',
        description: 'Vessel B',
        defaultVariant: 'only',
        variants: {
          only: {
            props: {},
            minSize: { width: 2, height: 2 },
            actions: [{ name: 'onB', description: 'Valid on B' }],
          },
        },
      };

      const request = makeGridRequest({
        instances: [
          { instanceId: 'dup', vesselId: 'a', variant: 'only' },
          { instanceId: 'dup', vesselId: 'b', variant: 'only' }, // last wins
        ],
        vessels: [vesselA, vesselB],
      });

      const llmOutput: GridResponse = {
        userMessage: 'Target the duplicate instance',
        rationale: 'Last-wins semantics',
        executionPlan: [
          { instanceId: 'dup', action: 'onA' }, // valid on vesselA, not on winner
          { instanceId: 'dup', action: 'onB' }, // valid on vesselB (the winner)
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // onA dropped (vesselA lost to vesselB on the duplicate key),
      // onB accepted (vesselB is the winner).
      expect(result.value.executionPlan).toHaveLength(1);
      expect(result.value.executionPlan[0].action).toBe('onB');
      expect(result.value.diagnostics.skippedActions).toHaveLength(1);
      expect(result.value.diagnostics.skippedActions[0].reason).toBe(
        'action_not_valid',
      );
    });

    test('no-transitionsTo action leaves simulated variant untouched for follow-ups', () => {
      // Pins the early-return in updateSimulatedVariant: if the branch
      // cleared sim.variants (or mutated it in any way) instead of leaving
      // it alone, the second action below would fail resolveAction because
      // 'advance' is only valid in 'start'.
      const vessel: Vessel = {
        id: 'nt-widget',
        name: 'No-Transition Widget',
        description:
          'Has a non-transitioning action and a transition from start',
        defaultVariant: 'start',
        variants: {
          start: {
            props: {},
            minSize: { width: 2, height: 2 },
            actions: [
              { name: 'ping', description: 'No transition' },
              {
                name: 'advance',
                description: 'Move to next',
                transitionsTo: 'next',
              },
            ],
          },
          next: {
            props: {},
            minSize: { width: 2, height: 2 },
            actions: [],
          },
        },
      };

      const request = makeGridRequest({
        instances: [
          { instanceId: 'nt-1', vesselId: 'nt-widget', variant: 'start' },
        ],
        vessels: [vessel],
      });

      const llmOutput: GridResponse = {
        userMessage: 'Ping then advance',
        rationale: 'First action stays in start, second advances',
        executionPlan: [
          { instanceId: 'nt-1', action: 'ping' },
          { instanceId: 'nt-1', action: 'advance' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // Both actions accepted — ping did not advance the sim variant, so
      // advance (which is valid in 'start') still resolves.
      expect(result.value.executionPlan).toHaveLength(2);
      expect(result.value.executionPlan[0].action).toBe('ping');
      expect(result.value.executionPlan[1].action).toBe('advance');
      expect(result.value.diagnostics.skippedActions).toEqual([]);
    });

    test('does not advance simulated variant when paramsJson fails to parse', () => {
      // When an action with invalid paramsJson is dropped, the runtime never
      // executes it, so the simulated variant must stay put. A follow-up
      // action on the same instance should still validate against the
      // original variant — not the phantom target of the dropped action.
      const vesselWithParamAction: Vessel = {
        id: 'param-widget',
        name: 'Param Widget',
        description: 'Has an action that takes params and transitions',
        defaultVariant: 'compact',
        variants: {
          compact: {
            props: {},
            minSize: { width: 2, height: 2 },
            actions: [
              {
                name: 'expand',
                description: 'Expand with options',
                parameters: [
                  {
                    name: 'mode',
                    type: 'string',
                    description: 'Expand mode',
                  },
                ],
                transitionsTo: 'expanded',
              },
            ],
          },
          expanded: {
            props: {},
            minSize: { width: 6, height: 4 },
            // Deliberately no 'expand' action — if the simulation incorrectly
            // advances, the second 'expand' below will be rejected.
            actions: [
              {
                name: 'collapse',
                description: 'Collapse',
                transitionsTo: 'compact',
              },
            ],
          },
        },
      };

      const request = makeGridRequest({
        instances: [
          { instanceId: 'pw-1', vesselId: 'param-widget', variant: 'compact' },
        ],
        vessels: [vesselWithParamAction],
      });

      const llmOutput: GridResponse = {
        userMessage: 'First with bad params, second without',
        rationale: 'Dropped action must not advance simulated variant',
        executionPlan: [
          // Invalid paramsJson → action is dropped; runtime stays in 'compact'
          { instanceId: 'pw-1', action: 'expand', paramsJson: '{bad json' },
          // Same action again without params → still valid in 'compact'
          { instanceId: 'pw-1', action: 'expand' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // First action dropped (bad params), second accepted (still in compact)
      expect(result.value.executionPlan).toHaveLength(1);
      expect(result.value.executionPlan[0]).toEqual({
        instanceId: InstanceId('pw-1'),
        action: 'expand',
      });
    });
  });

  describe('diagnostics.skippedActions', () => {
    test('is empty when every action is accepted', () => {
      const llmOutput: GridResponse = {
        userMessage: 'All good',
        rationale: 'Happy path',
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
      expect(result.value.diagnostics.skippedActions).toEqual([]);
    });

    test('records each LLM-path ResolveFailure kind with structured reason', () => {
      // Exercises all 4 LLM-reachable failure kinds in a single plan.
      // no_simulated_variant is excluded (engine invariant, structurally
      // unreachable under normal conditions).
      const request = makeGridRequest({
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
          { instanceId: 'orphan', vesselId: 'no-such-vessel', variant: 'x' },
          { instanceId: 'bad-var', vesselId: 'calendar', variant: 'deleted' },
        ],
      });

      const llmOutput: GridResponse = {
        userMessage: 'Bunch of bad actions',
        rationale: 'Exercise every LLM-path failure',
        executionPlan: [
          // 1. unknown_instance: instanceId not in request.instances
          { instanceId: 'ghost', action: 'noop' },
          // 2. unknown_vessel: instance exists but vesselId has no vessel def
          { instanceId: 'orphan', action: 'noop' },
          // 3. variant_not_on_vessel: instance variant doesn't exist on vessel
          { instanceId: 'bad-var', action: 'expand' },
          // 4. action_not_valid: real instance, real variant, missing action
          { instanceId: 'calendar-main', action: 'doesNotExist' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(llmOutput, request, silentLogger);
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const skipped = result.value.diagnostics.skippedActions;
      expect(skipped).toHaveLength(4);

      expect(skipped[0]).toEqual({
        instanceId: 'ghost',
        action: 'noop',
        reason: 'unknown_instance',
      });

      expect(skipped[1].reason).toBe('unknown_vessel');
      expect(skipped[1].instanceId).toBe('orphan');
      expect(skipped[1].detail).toContain('no-such-vessel');

      expect(skipped[2].reason).toBe('variant_not_on_vessel');
      expect(skipped[2].instanceId).toBe('bad-var');
      expect(skipped[2].detail).toContain('deleted');

      expect(skipped[3].reason).toBe('action_not_valid');
      expect(skipped[3].instanceId).toBe('calendar-main');
      expect(skipped[3].detail).toContain('vesselId=calendar');
      expect(skipped[3].detail).toContain('variant=month');
      expect(skipped[3].detail).toContain('validActions=[showWeek]');
    });

    test('records params_parse_failed when paramsJson is invalid', () => {
      const llmOutput: GridResponse = {
        userMessage: 'Bad params',
        rationale: 'Trigger params parse failure',
        executionPlan: [
          {
            instanceId: 'calendar-main',
            action: 'showWeek',
            paramsJson: '{not json',
          },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(
        llmOutput,
        makeGridRequest(),
        silentLogger,
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const skipped = result.value.diagnostics.skippedActions;
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toEqual({
        instanceId: 'calendar-main',
        action: 'showWeek',
        reason: 'params_parse_failed',
        detail: '{not json',
      });
    });

    test('preserves order matching the LLM execution plan', () => {
      const llmOutput: GridResponse = {
        userMessage: 'Two drops',
        rationale: 'Order preservation',
        executionPlan: [
          { instanceId: 'calendar-main', action: 'doesNotExist' },
          { instanceId: 'ghost', action: 'noop' },
        ],
        layout: { positions: [] },
      };

      const result = processResponse(
        llmOutput,
        makeGridRequest(),
        silentLogger,
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const skipped = result.value.diagnostics.skippedActions;
      expect(skipped.map((s) => s.reason)).toEqual([
        'action_not_valid',
        'unknown_instance',
      ]);
    });
  });
});
