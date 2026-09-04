import { describe, expect, it } from 'bun:test';

import {
  ChartRequestSchema,
  InstanceId,
  type LayoutMode,
  VariantName,
  type Vessel,
  VesselId,
  validateVessel,
} from '@maelstrom-co/protocol';

import type { VesselInstance } from '../types.js';
import { buildChartRequest } from './build-chart-request.js';

// `buildChartRequest` runs against post-validation vessels, so the fixture is
// branded through the real validation seam rather than cast — a malformed
// fixture fails here instead of slipping through an erased cast.
function makeTestVessel(): Vessel {
  const result = validateVessel({
    id: 'test',
    name: 'Test',
    description: 'Test vessel',
    defaultVariant: 'default',
    variants: {
      default: {
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [{ name: 'testAction', description: 'Test action' }],
      },
    },
  });
  if (!result.valid) {
    throw new Error('makeTestVessel: fixture failed validation');
  }
  return result.vessel;
}

const testVessel = makeTestVessel();

function buildParams(overrides: Record<string, unknown> = {}) {
  return {
    updates: [{ type: 'user_intent' as const, intent: 'show chart' }],
    instances: new Map<InstanceId, VesselInstance>(),
    chartDimensions: { columns: 12, rows: 8 },
    layout: null,
    vessels: [testVessel],
    config: {
      layoutMode: 'tiling' as LayoutMode,
    },
    ...overrides,
  };
}

describe('buildChartRequest', () => {
  it('should produce a correct request structure', () => {
    const request = buildChartRequest(buildParams());

    expect(request.type).toBe('chart_request');
    expect(request.context.layoutMode).toBe('tiling');
    expect(request.context.updateReasons).toHaveLength(1);
    expect(request.context.updateReasons[0]).toEqual({
      type: 'user_intent',
      intent: 'show chart',
    });
  });

  it('should NOT carry envelope-only fields on the inner payload', () => {
    // Locks in the envelope-only rule for id / sessionId / timestamp.
    // A regression that re-adds any of these to ChartRequest would fail
    // these assertions instead of silently shipping duplicate fields.
    const request = buildChartRequest(buildParams());

    expect('id' in request).toBe(false);
    expect('sessionId' in request.context).toBe(false);
    expect('timestamp' in request.context).toBe(false);
  });

  it('should map instance snapshots to instanceId, vesselId, variant only', () => {
    const instances = new Map<InstanceId, VesselInstance>();
    instances.set(InstanceId('i-1'), {
      instanceId: InstanceId('i-1'),
      vesselId: VesselId('v-1'),
      variant: VariantName('default'),
      position: { column: 0, row: 0 },
      size: { width: 2, height: 2 },
    });

    const request = buildChartRequest(buildParams({ instances }));

    expect(request.instances).toEqual([
      {
        instanceId: InstanceId('i-1'),
        vesselId: VesselId('v-1'),
        variant: VariantName('default'),
      },
    ]);
  });

  it('should default to empty tiling layout when layout is null and mode is tiling', () => {
    const request = buildChartRequest(buildParams());

    expect(request.layout).toEqual({
      type: 'tiling',
      tree: [],
      instances: [],
    });
  });

  it('should default to empty grid layout when layout is null and mode is grid', () => {
    const request = buildChartRequest(
      buildParams({
        config: { layoutMode: 'grid' as LayoutMode },
      }),
    );

    expect(request.layout).toEqual({ type: 'grid', positions: [] });
  });

  it('should pass through vessels and dimensions', () => {
    const request = buildChartRequest(buildParams());

    expect(request.vessels).toEqual([testVessel]);
    expect(request.context.chartDimensions).toEqual({
      columns: 12,
      rows: 8,
    });
  });

  it('should use existing layout when present', () => {
    const existingLayout = {
      type: 'tiling' as const,
      tree: [],
      instances: [
        {
          instanceId: InstanceId('i-1'),
          vesselId: VesselId('v-1'),
          variant: VariantName('default'),
        },
      ],
    };

    const request = buildChartRequest(buildParams({ layout: existingLayout }));

    expect(request.layout).toBe(existingLayout);
  });

  it('should synthesize a fresh empty layout of layoutMode when the stored layout is a different type', () => {
    // The wire schema rejects a request whose layout.type disagrees with
    // context.layoutMode. A stored layout can predate a layout-mode change
    // (Orchestrator.setLayoutMode does not touch it), so this is the one
    // place that invariant actually has to hold.
    const staleTilingLayout = {
      type: 'tiling' as const,
      tree: [],
      instances: [
        {
          instanceId: InstanceId('i-1'),
          vesselId: VesselId('v-1'),
          variant: VariantName('default'),
        },
      ],
    };

    const request = buildChartRequest(
      buildParams({
        layout: staleTilingLayout,
        config: { layoutMode: 'grid' as LayoutMode },
      }),
    );

    expect(request.context.layoutMode).toBe('grid');
    expect(request.layout).toEqual({ type: 'grid', positions: [] });
    // Not just equal in shape — a genuinely fresh object, not the stale one.
    expect(request.layout).not.toBe(staleTilingLayout);
  });

  it('keeps retained hidden tiling Instances in the Engine request', () => {
    const weatherId = InstanceId('weather-1');
    const calendarId = InstanceId('calendar-1');
    const tasksId = InstanceId('tasks-1');
    const instances = new Map<InstanceId, VesselInstance>([
      [
        weatherId,
        {
          instanceId: weatherId,
          vesselId: testVessel.id,
          variant: VariantName('default'),
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
      [
        calendarId,
        {
          instanceId: calendarId,
          vesselId: testVessel.id,
          variant: VariantName('default'),
          position: { column: 1, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
      [
        tasksId,
        {
          instanceId: tasksId,
          vesselId: testVessel.id,
          variant: VariantName('default'),
          position: { column: 2, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    ]);
    const layout = {
      type: 'tiling' as const,
      tree: ['ID:weather-1' as const],
      instances: [...instances.values()].map(
        ({ instanceId, vesselId, variant }) => ({
          instanceId,
          vesselId,
          variant,
        }),
      ),
    };

    const request = buildChartRequest(buildParams({ instances, layout }));

    expect(request.instances.map(({ instanceId }) => instanceId)).toEqual([
      weatherId,
      calendarId,
      tasksId,
    ]);
    expect(request.layout.type).toBe('tiling');
    if (request.layout.type !== 'tiling') {
      throw new Error('expected tiling layout');
    }
    expect(
      request.layout.instances.map(({ instanceId }) => instanceId),
    ).toEqual([weatherId, calendarId, tasksId]);
    expect(request.layout.tree).toEqual(['ID:weather-1']);
    expect(() => ChartRequestSchema.parse(request)).not.toThrow();
  });

  it('declares every live instance in the synthesized tiling layout when switching from grid to tiling', () => {
    // Regression: the tiling fallback used to synthesize `instances: []`
    // unconditionally. ChartRequestSchema's tiling branch requires every
    // top-level instance to also appear in layout.instances, so a board
    // with live instances produced a request the schema rejects outright —
    // and since only a successful engine response can replace the stored
    // layout, that wedges the session permanently.
    const instances = new Map([
      [
        InstanceId('i-1'),
        {
          instanceId: InstanceId('i-1'),
          vesselId: testVessel.id,
          variant: VariantName('default'),
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    ]);
    const staleGridLayout = { type: 'grid' as const, positions: [] };

    const request = buildChartRequest(
      buildParams({
        instances,
        layout: staleGridLayout,
        config: { layoutMode: 'tiling' as LayoutMode },
      }),
    );

    expect(request.layout).toEqual({
      type: 'tiling',
      tree: [],
      instances: [
        {
          instanceId: InstanceId('i-1'),
          vesselId: testVessel.id,
          variant: VariantName('default'),
        },
      ],
    });

    // Assert against the real wire schema, not a hand-rolled shape check —
    // this is exactly the request the orchestrator would send.
    expect(() => ChartRequestSchema.parse(request)).not.toThrow();
  });
});
