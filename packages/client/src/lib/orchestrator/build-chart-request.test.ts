import { describe, expect, it } from 'bun:test';

import {
  InstanceId,
  VariantName,
  VesselId,
  validateVessel,
  type LayoutMode,
  type Vessel,
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
});
