import { describe, expect, test } from 'bun:test';
import type { ChartRequest } from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';
import {
  buildGridChartState,
  buildTilingChartState,
  buildUpdateTriggersSection,
  buildUserSections,
  buildVesselsSection,
} from './request-serializer.js';
import type { Logger } from '../logger.js';
import {
  makeGridRequest,
  makeTilingRequest,
} from '../__test-helpers__/fixtures.js';

function createSpyLogger(): { logger: Logger; warns: string[] } {
  const warns: string[] = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (msg) => warns.push(msg),
    error: () => {},
  };
  return { logger, warns };
}

// ---------------------------------------------------------------------------
// Vessels section
// ---------------------------------------------------------------------------

describe('buildVesselsSection', () => {
  test('includes header and vessel entry', () => {
    const output = buildVesselsSection(makeGridRequest().vessels);
    expect(output).toContain('## Registered Vessels');
    expect(output).toContain('calendar - Calendar');
    expect(output).toContain('month (default)');
  });

  test('serializes action with transition', () => {
    const output = buildVesselsSection(makeGridRequest().vessels);
    expect(output).toContain('showWeek');
    expect(output).toContain('→ week');
  });

  test('serializes action with parameters', () => {
    const request = makeGridRequest({
      vessels: [
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
                      description: 'Order ID',
                    },
                  ],
                  transitionsTo: 'detail',
                },
              ],
            },
            detail: {
              props: {},
              minSize: { width: 6, height: 4 },
              actions: [],
            },
          },
        },
      ],
    });
    const output = buildVesselsSection(request.vessels);
    expect(output).toContain('selectOrder(orderId: string)');
    expect(output).toContain('"Select an order"');
  });

  test('serializes action with enum parameter', () => {
    const request = makeGridRequest({
      vessels: [
        {
          id: 'table',
          name: 'Table',
          description: 'Data table',
          defaultVariant: 'default',
          variants: {
            default: {
              props: {},
              minSize: { width: 4, height: 4 },
              actions: [
                {
                  name: 'sort',
                  description: 'Sort column',
                  parameters: [
                    {
                      name: 'direction',
                      type: 'string',
                      description: 'Sort direction',
                      enum: ['asc', 'desc'],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    });
    const output = buildVesselsSection(request.vessels);
    expect(output).toContain('sort(direction: asc|desc)');
  });
});

// ---------------------------------------------------------------------------
// Grid chart state
// ---------------------------------------------------------------------------

describe('buildGridChartState', () => {
  test('includes layout mode, dimensions, and positions', () => {
    const output = buildGridChartState(makeGridRequest());
    expect(output).toContain('Layout Mode: Grid');
    expect(output).toContain('12×8 cells');
    expect(output).toContain('calendar-main: row=0, col=0, size=6×4');
  });

  test('handles empty positions', () => {
    const request = makeGridRequest({
      layout: { type: 'grid', positions: [] },
      instances: [],
    });
    const output = buildGridChartState(request);
    expect(output).toContain('No vessels currently positioned.');
  });

  test('warns and omits Actions when instance references unknown vessel', () => {
    const { logger, warns } = createSpyLogger();
    const request = makeGridRequest({
      instances: [
        {
          instanceId: InstanceId('orphan'),
          vesselId: 'missing-vessel',
          variant: 'month',
        },
      ],
      layout: {
        type: 'grid',
        positions: [
          {
            instanceId: InstanceId('orphan'),
            position: { row: 0, column: 0 },
            size: { width: 6, height: 4 },
          },
        ],
      },
    });
    const output = buildGridChartState(request, logger);
    expect(output).toContain('orphan: row=0, col=0, size=6×4');
    expect(output).not.toContain('Actions:');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('orphan');
    expect(warns[0]).toContain('missing-vessel');
  });

  test('warns and omits Actions when instance references unknown variant', () => {
    const { logger, warns } = createSpyLogger();
    const request = makeGridRequest({
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'calendar',
          variant: 'stale-variant',
        },
      ],
    });
    const output = buildGridChartState(request, logger);
    expect(output).toContain('calendar-main: row=0, col=0, size=6×4');
    expect(output).not.toContain('Actions:');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('calendar-main');
    expect(warns[0]).toContain('stale-variant');
    expect(warns[0]).toContain('calendar');
  });

  test('includes a free-space section when the grid has empty cells', () => {
    const request = makeGridRequest(); // calendar-main occupies 6x4 at (0,0) on a 12x8 chart
    const output = buildGridChartState(request);
    expect(output).toContain('Free regions where vessels can be placed:');
    // The 12x4 block below the calendar (48 cells) is the largest free rect.
    expect(output).toContain('12x4 (48 cells) at row=4, col=0');

    // Positioned-vessels block must precede free-space block, and the
    // free-space heading must appear exactly once so a duplicated emitter
    // would not pass.
    const positionedIdx = output.indexOf('calendar-main:');
    const freeRegionsIdx = output.indexOf('Free regions');
    expect(positionedIdx).toBeGreaterThanOrEqual(0);
    expect(freeRegionsIdx).toBeGreaterThan(positionedIdx);
    expect(output.match(/Free regions/g)).toHaveLength(1);
  });

  test('includes the no-free-space message when the grid is fully packed', () => {
    const request = makeGridRequest({
      layout: {
        type: 'grid',
        positions: [
          {
            instanceId: InstanceId('calendar-main'),
            position: { row: 0, column: 0 },
            size: { width: 12, height: 8 },
          },
        ],
      },
    });
    const output = buildGridChartState(request);
    expect(output).toContain(
      'No free space available. Consider hiding or resizing existing vessels.',
    );
  });
});

// ---------------------------------------------------------------------------
// Tiling chart state
// ---------------------------------------------------------------------------

describe('buildTilingChartState', () => {
  test('includes layout mode header and visible instances', () => {
    const output = buildTilingChartState(makeTilingRequest());
    expect(output).toContain('Layout Mode: Tiling (binary tree)');
    expect(output).toContain('Currently Visible:');
    expect(output).toContain('calendar-main (calendar), variant: month');
  });

  test('shows tiling tree preorder', () => {
    const output = buildTilingChartState(makeTilingRequest());
    expect(output).toContain('Preorder: ["calendar-main"]');
  });

  test('shows hidden instances separately from visible', () => {
    const request: ChartRequest = {
      ...makeTilingRequest(),
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'calendar',
          variant: 'month',
        },
        {
          instanceId: InstanceId('tasks-main'),
          vesselId: 'calendar',
          variant: 'month',
        },
      ],
      layout: {
        type: 'tiling',
        tree: [InstanceId('calendar-main')],
        instances: [
          {
            instanceId: InstanceId('calendar-main'),
            vesselId: 'calendar',
            variant: 'month',
          },
          {
            instanceId: InstanceId('tasks-main'),
            vesselId: 'calendar',
            variant: 'month',
          },
        ],
      },
    };
    const output = buildTilingChartState(request);
    expect(output).toContain('Currently Visible:');
    expect(output).toContain('Available (hidden):');
    expect(output).toContain('tasks-main');
  });

  test('handles tree with null, H, and V nodes', () => {
    const request: ChartRequest = {
      ...makeTilingRequest(),
      instances: [
        { instanceId: InstanceId('a'), vesselId: 'calendar', variant: 'month' },
        { instanceId: InstanceId('b'), vesselId: 'calendar', variant: 'month' },
      ],
      layout: {
        type: 'tiling',
        tree: ['V', InstanceId('a'), 'H', InstanceId('b'), null],
        instances: [
          {
            instanceId: InstanceId('a'),
            vesselId: 'calendar',
            variant: 'month',
          },
          {
            instanceId: InstanceId('b'),
            vesselId: 'calendar',
            variant: 'month',
          },
        ],
      },
    };
    const output = buildTilingChartState(request);
    expect(output).toContain('Currently Visible:');
    expect(output).toContain('- a (calendar)');
    expect(output).toContain('- b (calendar)');
    expect(output).toContain('Preorder: ["V","a","H","b",null]');
  });

  test('shows no vessels when tree is empty', () => {
    const request: ChartRequest = {
      ...makeTilingRequest(),
      instances: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    };
    const output = buildTilingChartState(request);
    expect(output).toContain('No vessels currently visible.');
  });

  test('serializes actions for tiling instances', () => {
    const baseRequest = makeTilingRequest();
    const request = {
      ...baseRequest,
      vessels: [
        {
          ...baseRequest.vessels[0],
          variants: {
            month: {
              ...baseRequest.vessels[0]?.variants.month,
              actions: [
                {
                  name: 'showWeek',
                  description: 'Switch to week',
                  transitionsTo: 'week',
                },
              ],
            },
          },
        },
      ],
    };
    const output = buildTilingChartState(request);
    expect(output).toContain('Available: showWeek');
  });

  test('warns and omits Available when instance references unknown vessel', () => {
    const { logger, warns } = createSpyLogger();
    const request: ChartRequest = {
      ...makeTilingRequest(),
      instances: [
        {
          instanceId: InstanceId('orphan'),
          vesselId: 'missing-vessel',
          variant: 'month',
        },
      ],
      layout: {
        type: 'tiling',
        tree: [InstanceId('orphan')],
        instances: [
          {
            instanceId: InstanceId('orphan'),
            vesselId: 'missing-vessel',
            variant: 'month',
          },
        ],
      },
    };
    const output = buildTilingChartState(request, logger);
    expect(output).toContain('- orphan (missing-vessel), variant: month');
    expect(output).not.toContain('Available:');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('orphan');
    expect(warns[0]).toContain('missing-vessel');
  });

  test('warns and omits Available when instance references unknown variant', () => {
    const { logger, warns } = createSpyLogger();
    const request: ChartRequest = {
      ...makeTilingRequest(),
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'calendar',
          variant: 'stale-variant',
        },
      ],
      layout: {
        type: 'tiling',
        tree: [InstanceId('calendar-main')],
        instances: [
          {
            instanceId: InstanceId('calendar-main'),
            vesselId: 'calendar',
            variant: 'stale-variant',
          },
        ],
      },
    };
    const output = buildTilingChartState(request, logger);
    expect(output).toContain(
      '- calendar-main (calendar), variant: stale-variant',
    );
    expect(output).not.toContain('Available:');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('calendar-main');
    expect(warns[0]).toContain('stale-variant');
    expect(warns[0]).toContain('calendar');
  });
});

// ---------------------------------------------------------------------------
// Update triggers
// ---------------------------------------------------------------------------

describe('buildUpdateTriggersSection', () => {
  test('handles user intent', () => {
    const output = buildUpdateTriggersSection(
      makeGridRequest().context.updateReasons,
    );
    expect(output).toContain('User said: "Show me my calendar"');
  });

  test('handles chart resize reason', () => {
    const output = buildUpdateTriggersSection([
      {
        type: 'chart_resize',
        previous: { columns: 8, rows: 6 },
        current: { columns: 12, rows: 8 },
      },
    ]);
    expect(output).toContain('Chart resized: 8×6 → 12×8');
  });

  test('handles vessel mutation reason', () => {
    const output = buildUpdateTriggersSection([
      {
        type: 'vessel_mutation',
        instanceId: InstanceId('calendar-main'),
        changes: 'date range updated',
      },
    ]);
    expect(output).toContain(
      'Vessel "calendar-main" was modified: date range updated',
    );
  });

  test('handles no triggers', () => {
    const output = buildUpdateTriggersSection([]);
    expect(output).toContain('No specific trigger (system check)');
  });
});

// ---------------------------------------------------------------------------
// buildUserSections (top-level serializer entry)
// ---------------------------------------------------------------------------

describe('buildUserSections', () => {
  test('returns sections keyed vessels / chartState / updateTriggers for grid', () => {
    const sections = buildUserSections(makeGridRequest());
    const keys = sections.map((s) => s.key);
    expect(keys).toEqual(['vessels', 'chartState', 'updateTriggers']);
  });

  test('routes to grid chart-state builder for grid mode', () => {
    const sections = buildUserSections(makeGridRequest());
    const chartState = sections.find((s) => s.key === 'chartState');
    expect(chartState?.content).toContain('Layout Mode: Grid');
  });

  test('routes to tiling chart-state builder for tiling mode', () => {
    const sections = buildUserSections(makeTilingRequest());
    const chartState = sections.find((s) => s.key === 'chartState');
    expect(chartState?.content).toContain('Layout Mode: Tiling (binary tree)');
  });
});
