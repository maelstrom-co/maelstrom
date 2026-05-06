import { describe, expect, test } from 'bun:test';

import { ActionName } from './action-name.js';
import { InstanceId } from './instance.js';
import {
  ChartRequestSchema,
  ChartResizeReasonSchema,
  GridResponseSchema,
  TilingResponseSchema,
  UpdateReasonSchema,
  UserIntentReasonSchema,
  VesselMutationReasonSchema,
} from './request.js';
import { VariantName } from './variant-name.js';
import { VesselId } from './vessel-id.js';

// Type-level equality. If the inferred type drifts (e.g. a `.transform(Brand)`
// is removed from the schema), the corresponding `const _check: Equals<...>`
// flips from `true` to `false` and tsc fails the typecheck step — which is
// the only place this test layer can run, since brands erase at runtime.
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

const gridPayload = (layout: unknown) => ({
  userMessage: 'ok',
  rationale: 'r',
  executionPlan: [],
  layout,
});

const tilingPayload = (layout: unknown) => ({
  userMessage: 'ok',
  rationale: 'r',
  executionPlan: [],
  layout,
});

describe('GridResponseSchema', () => {
  test('accepts a minimal valid payload', () => {
    const result = GridResponseSchema.safeParse(gridPayload({ positions: [] }));
    expect(result.success).toBe(true);
  });

  test('accepts positions with instanceId, position, and size', () => {
    const result = GridResponseSchema.safeParse(
      gridPayload({
        positions: [
          {
            instanceId: 'calendar-main',
            position: { row: 0, column: 0 },
            size: { width: 6, height: 4 },
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  test('rejects missing top-level fields', () => {
    const result = GridResponseSchema.safeParse({
      userMessage: 'ok',
      layout: { positions: [] },
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative row/column', () => {
    const result = GridResponseSchema.safeParse(
      gridPayload({
        positions: [
          {
            instanceId: 'x',
            position: { row: -1, column: 0 },
            size: { width: 1, height: 1 },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  test('rejects zero width/height (minSize is 1)', () => {
    const result = GridResponseSchema.safeParse(
      gridPayload({
        positions: [
          {
            instanceId: 'x',
            position: { row: 0, column: 0 },
            size: { width: 0, height: 1 },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe('TilingResponseSchema', () => {
  test('accepts a minimal valid payload', () => {
    const result = TilingResponseSchema.safeParse(
      tilingPayload({ tree: [], instances: [] }),
    );
    expect(result.success).toBe(true);
  });

  test('accepts a tree with splits, instance ids, and null', () => {
    const result = TilingResponseSchema.safeParse(
      tilingPayload({
        tree: ['V', 'calendar-main', 'H', 'tasks-main', null],
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
          { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  test('rejects non-array tree', () => {
    const result = TilingResponseSchema.safeParse(
      tilingPayload({ tree: 'not-an-array', instances: [] }),
    );
    expect(result.success).toBe(false);
  });

  test('rejects instance entries missing required fields', () => {
    const result = TilingResponseSchema.safeParse(
      tilingPayload({ tree: [], instances: [{ instanceId: 'x' }] }),
    );
    expect(result.success).toBe(false);
  });
});

describe('execution plan', () => {
  test('GridResponseSchema accepts optional paramsJson', () => {
    const result = GridResponseSchema.safeParse({
      ...gridPayload({ positions: [] }),
      executionPlan: [
        { instanceId: 'x', action: 'select', paramsJson: '{"id":"1"}' },
        { instanceId: 'y', action: 'close' },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('rejects executionPlan items missing instanceId', () => {
    const result = GridResponseSchema.safeParse({
      ...gridPayload({ positions: [] }),
      executionPlan: [{ action: 'select' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('UserIntentReasonSchema', () => {
  test('parses a valid user intent', () => {
    const result = UserIntentReasonSchema.safeParse({
      type: 'user_intent',
      intent: 'show me the calendar',
    });
    expect(result.success).toBe(true);
  });

  test('rejects wrong discriminator', () => {
    expect(
      UserIntentReasonSchema.safeParse({ type: 'chart_resize', intent: 'x' })
        .success,
    ).toBe(false);
  });

  test('rejects missing intent', () => {
    expect(
      UserIntentReasonSchema.safeParse({ type: 'user_intent' }).success,
    ).toBe(false);
  });
});

describe('ChartResizeReasonSchema', () => {
  test('parses a valid chart resize', () => {
    const result = ChartResizeReasonSchema.safeParse({
      type: 'chart_resize',
      previous: { rows: 8, columns: 12 },
      current: { rows: 12, columns: 16 },
    });
    expect(result.success).toBe(true);
  });

  test('rejects malformed dimensions', () => {
    expect(
      ChartResizeReasonSchema.safeParse({
        type: 'chart_resize',
        previous: { rows: 0, columns: 12 },
        current: { rows: 12, columns: 16 },
      }).success,
    ).toBe(false);
  });
});

describe('VesselMutationReasonSchema', () => {
  test('parses a valid vessel mutation', () => {
    const result = VesselMutationReasonSchema.safeParse({
      type: 'vessel_mutation',
      instanceId: 'cal-1',
      changes: 'switched to detail variant',
    });
    expect(result.success).toBe(true);
  });

  test('rejects missing instanceId', () => {
    expect(
      VesselMutationReasonSchema.safeParse({
        type: 'vessel_mutation',
        changes: 'x',
      }).success,
    ).toBe(false);
  });

  test('rejects empty instanceId', () => {
    expect(
      VesselMutationReasonSchema.safeParse({
        type: 'vessel_mutation',
        instanceId: '',
        changes: 'x',
      }).success,
    ).toBe(false);
  });

  test('brands instanceId via .transform()', () => {
    const result = VesselMutationReasonSchema.safeParse({
      type: 'vessel_mutation',
      instanceId: 'cal-1',
      changes: 'switched to detail variant',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.instanceId).toBe(InstanceId('cal-1'));

    type _Branded = Equals<typeof result.data.instanceId, InstanceId>;
    const _check: _Branded = true;
    void _check;
  });
});

describe('UpdateReasonSchema', () => {
  test('discriminates on type — user_intent', () => {
    expect(
      UpdateReasonSchema.safeParse({
        type: 'user_intent',
        intent: 'hi',
      }).success,
    ).toBe(true);
  });

  test('discriminates on type — chart_resize', () => {
    expect(
      UpdateReasonSchema.safeParse({
        type: 'chart_resize',
        previous: { rows: 8, columns: 12 },
        current: { rows: 12, columns: 16 },
      }).success,
    ).toBe(true);
  });

  test('discriminates on type — vessel_mutation', () => {
    expect(
      UpdateReasonSchema.safeParse({
        type: 'vessel_mutation',
        instanceId: 'cal-1',
        changes: 'x',
      }).success,
    ).toBe(true);
  });

  test('rejects unknown discriminator', () => {
    expect(
      UpdateReasonSchema.safeParse({ type: 'unknown', intent: 'x' }).success,
    ).toBe(false);
  });

  test('rejects missing discriminator', () => {
    expect(UpdateReasonSchema.safeParse({ intent: 'x' }).success).toBe(false);
  });
});

const validChartRequest = () => ({
  type: 'chart_request' as const,
  context: {
    updateReasons: [{ type: 'user_intent', intent: 'show calendar' }],
    chartDimensions: { rows: 12, columns: 16 },
    layoutMode: 'grid' as const,
  },
  instances: [],
  vessels: [],
  layout: { positions: [] },
});

describe('ChartRequestSchema', () => {
  test('parses a minimal valid chart_request', () => {
    const result = ChartRequestSchema.safeParse(validChartRequest());
    expect(result.success).toBe(true);
  });

  test('rejects wrong type discriminator', () => {
    const req = { ...validChartRequest(), type: 'other' };
    expect(ChartRequestSchema.safeParse(req).success).toBe(false);
  });

  test('rejects unknown layoutMode', () => {
    const req = validChartRequest();
    const bad = {
      ...req,
      context: { ...req.context, layoutMode: 'flex' },
    };
    expect(ChartRequestSchema.safeParse(bad).success).toBe(false);
  });

  test('rejects malformed updateReasons', () => {
    const req = validChartRequest();
    const bad = {
      ...req,
      context: {
        ...req.context,
        updateReasons: [{ type: 'unknown' }],
      },
    };
    expect(ChartRequestSchema.safeParse(bad).success).toBe(false);
  });

  test('accepts a tiling layout with a tree', () => {
    const req = validChartRequest();
    const tiling = {
      ...req,
      context: { ...req.context, layoutMode: 'tiling' as const },
      layout: { tree: [], instances: [] },
    };
    expect(ChartRequestSchema.safeParse(tiling).success).toBe(true);
  });

  test('strips extra top-level fields', () => {
    const req = { ...validChartRequest(), extra: 'should be stripped' };
    const result = ChartRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('extra' in result.data).toBe(false);
    }
  });
});

describe('schema branding', () => {
  test('GridResponseSchema brands instanceId/action/layout positions via .transform()', () => {
    const result = GridResponseSchema.safeParse({
      userMessage: 'hi',
      rationale: 'r',
      executionPlan: [{ instanceId: 'foo', action: 'doIt' }],
      layout: {
        positions: [
          {
            instanceId: 'bar',
            position: { row: 0, column: 0 },
            size: { width: 1, height: 1 },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');

    // Runtime: structural shape preserved (brand erases).
    expect(result.data.executionPlan[0]?.instanceId).toBe(InstanceId('foo'));
    expect(result.data.executionPlan[0]?.action).toBe(ActionName('doIt'));
    expect(result.data.layout.positions[0]?.instanceId).toBe(InstanceId('bar'));

    // Type-level: each .transform(Brand) on the schema must surface as the
    // branded type on the inferred output. Removing any transform flips the
    // matching Equals to `false`, which fails the typecheck.
    type _InstanceIdBranded = Equals<
      NonNullable<(typeof result.data.executionPlan)[number]['instanceId']>,
      InstanceId
    >;
    type _ActionBranded = Equals<
      NonNullable<(typeof result.data.executionPlan)[number]['action']>,
      ActionName
    >;
    type _PositionInstanceIdBranded = Equals<
      NonNullable<(typeof result.data.layout.positions)[number]['instanceId']>,
      InstanceId
    >;
    const _checkInstanceId: _InstanceIdBranded = true;
    const _checkAction: _ActionBranded = true;
    const _checkPositionInstanceId: _PositionInstanceIdBranded = true;
    void _checkInstanceId;
    void _checkAction;
    void _checkPositionInstanceId;
  });

  test('TilingResponseSchema brands tree InstanceIds and instance vesselId/variant', () => {
    const result = TilingResponseSchema.safeParse({
      userMessage: 'hi',
      rationale: 'r',
      executionPlan: [],
      layout: {
        tree: ['V', 'calendar-main', 'tasks-main'],
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
          { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');

    // Runtime: structural shape preserved (brand erases).
    expect(result.data.layout.tree).toContain(InstanceId('calendar-main'));
    expect(result.data.layout.tree).toContain(InstanceId('tasks-main'));
    expect(result.data.layout.instances[0]?.instanceId).toBe(
      InstanceId('calendar-main'),
    );
    expect(result.data.layout.instances[0]?.vesselId).toBe(
      VesselId('calendar'),
    );
    expect(result.data.layout.instances[0]?.variant).toBe(VariantName('month'));

    // Type-level: tree leaves must be branded as `InstanceId` (split tokens
    // and `null` pass through unchanged). The instance fields must each
    // carry their respective brand.
    type _TreeNodeBrand = Equals<
      (typeof result.data.layout.tree)[number],
      'H' | 'V' | InstanceId | null
    >;
    type _InstancesInstanceIdBranded = Equals<
      (typeof result.data.layout.instances)[number]['instanceId'],
      InstanceId
    >;
    type _InstancesVesselIdBranded = Equals<
      (typeof result.data.layout.instances)[number]['vesselId'],
      VesselId
    >;
    type _InstancesVariantBranded = Equals<
      (typeof result.data.layout.instances)[number]['variant'],
      VariantName
    >;
    const _checkTree: _TreeNodeBrand = true;
    const _checkInstanceId: _InstancesInstanceIdBranded = true;
    const _checkVesselId: _InstancesVesselIdBranded = true;
    const _checkVariant: _InstancesVariantBranded = true;
    void _checkTree;
    void _checkInstanceId;
    void _checkVesselId;
    void _checkVariant;
  });
});

describe('contextual validation messages', () => {
  test('rejects empty instanceId in GridResponse executionPlan with a contextual message', () => {
    const result = GridResponseSchema.safeParse({
      userMessage: 'hi',
      rationale: 'r',
      executionPlan: [{ instanceId: '', action: 'doIt' }],
      layout: { positions: [] },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(
      result.error.issues.some((i) => /instanceId is required/.test(i.message)),
    ).toBe(true);
  });

  test('rejects empty action with a contextual message', () => {
    const result = GridResponseSchema.safeParse({
      userMessage: 'hi',
      rationale: 'r',
      executionPlan: [{ instanceId: 'x', action: '' }],
      layout: { positions: [] },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(
      result.error.issues.some((i) => /action is required/.test(i.message)),
    ).toBe(true);
  });

  test('rejects empty vesselId in TilingResponse instances with a contextual message', () => {
    const result = TilingResponseSchema.safeParse({
      userMessage: 'hi',
      rationale: 'r',
      executionPlan: [],
      layout: {
        tree: [],
        instances: [{ instanceId: 'a', vesselId: '', variant: 'default' }],
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(
      result.error.issues.some((i) => /vesselId is required/.test(i.message)),
    ).toBe(true);
  });

  test('rejects empty variant in TilingResponse instances with a contextual message', () => {
    const result = TilingResponseSchema.safeParse({
      userMessage: 'hi',
      rationale: 'r',
      executionPlan: [],
      layout: {
        tree: [],
        instances: [{ instanceId: 'a', vesselId: 'calendar', variant: '' }],
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(
      result.error.issues.some((i) => /variant is required/.test(i.message)),
    ).toBe(true);
  });
});
