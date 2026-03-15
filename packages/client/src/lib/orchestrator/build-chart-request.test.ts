import { describe, expect, it } from 'bun:test';

import type { LayoutMode } from '@maelstrom/protocol';
import { defineVessel } from '@maelstrom/protocol';

import type { VesselInstance } from '../types.js';
import { buildChartRequest } from './build-chart-request.js';

const testVessel = defineVessel({
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

function buildParams(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    updates: [{ type: 'user_intent' as const, intent: 'show chart' }],
    instances: new Map<string, VesselInstance>(),
    chartDimensions: { columns: 12, rows: 8 },
    layout: null,
    vessels: [testVessel],
    config: { sessionId: 'session-1', layoutMode: 'tiling' as LayoutMode },
    ...overrides,
  };
}

describe('buildChartRequest', () => {
  it('should produce a correct request structure', () => {
    const request = buildChartRequest(buildParams());

    expect(request.type).toBe('chart_request');
    expect(request.id).toBe('req-1');
    expect(request.context.sessionId).toBe('session-1');
    expect(request.context.layoutMode).toBe('tiling');
    expect(request.context.updateReasons).toHaveLength(1);
    expect(request.context.updateReasons[0]).toEqual({
      type: 'user_intent',
      intent: 'show chart',
    });
    expect(typeof request.context.timestamp).toBe('number');
  });

  it('should map instance snapshots to instanceId, vesselId, variant only', () => {
    const instances = new Map<string, VesselInstance>();
    instances.set('i-1', {
      instanceId: 'i-1',
      vesselId: 'v-1',
      variant: 'default',
      position: { column: 0, row: 0 },
      size: { width: 2, height: 2 },
    });

    const request = buildChartRequest(buildParams({ instances }));

    expect(request.instances).toEqual([
      { instanceId: 'i-1', vesselId: 'v-1', variant: 'default' },
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
        config: { sessionId: 'session-1', layoutMode: 'grid' as LayoutMode },
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
      instances: [{ instanceId: 'i-1', vesselId: 'v-1', variant: 'default' }],
    };

    const request = buildChartRequest(buildParams({ layout: existingLayout }));

    expect(request.layout).toBe(existingLayout);
  });
});
