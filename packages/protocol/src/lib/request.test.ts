import { describe, expect, test } from 'bun:test';
import type { z } from 'zod';

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
import type { VesselInstanceSnapshotSchema } from './schemas.js';
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

  test.each([
    {
      name: 'GridResponseSchema',
      schema: GridResponseSchema,
      payload: gridPayload({ positions: [] }),
    },
    {
      name: 'TilingResponseSchema',
      schema: TilingResponseSchema,
      payload: tilingPayload({ tree: [], instances: [] }),
    },
  ])('rejects paramsJson above 16384 UTF-8 bytes ($name)', ({
    schema,
    payload,
  }) => {
    const atLimit = `{"value":"${'é'.repeat(8186)}"}`;
    const overLimit = `{"value":"${'é'.repeat(8186)}a"}`;
    const encoder = new TextEncoder();

    expect(encoder.encode(atLimit).byteLength).toBe(16_384);
    expect(encoder.encode(overLimit).byteLength).toBe(16_385);

    expect(
      schema.safeParse({
        ...payload,
        executionPlan: [
          { instanceId: 'x', action: 'select', paramsJson: atLimit },
        ],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...payload,
        executionPlan: [
          { instanceId: 'x', action: 'select', paramsJson: overLimit },
        ],
      }).success,
    ).toBe(false);
  });

  test.each([
    {
      name: 'GridResponseSchema',
      schema: GridResponseSchema,
      payload: gridPayload({ positions: [] }),
    },
    {
      name: 'TilingResponseSchema',
      schema: TilingResponseSchema,
      payload: tilingPayload({ tree: [], instances: [] }),
    },
  ])('rejects executionPlan above 64 entries ($name)', ({
    schema,
    payload,
  }) => {
    const action = { instanceId: 'x', action: 'select' };

    expect(
      schema.safeParse({
        ...payload,
        executionPlan: Array.from({ length: 64 }, () => action),
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...payload,
        executionPlan: Array.from({ length: 65 }, () => action),
      }).success,
    ).toBe(false);
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
  layout: { type: 'grid' as const, positions: [] },
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
      layout: { type: 'tiling' as const, tree: [], instances: [] },
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

// ---------------------------------------------------------------------------
// Cross-validation fixture builders
// ---------------------------------------------------------------------------

// Pinned to the schema's input shape so a future field on
// `VesselInstanceSnapshotSchema` breaks fixture call sites at compile time.
type InstanceLiteral = z.input<typeof VesselInstanceSnapshotSchema>;

const minimalVessel = (id: string, variantNames: readonly string[]) => ({
  id,
  name: id,
  description: `${id} vessel`,
  defaultVariant: variantNames[0],
  variants: Object.fromEntries(
    variantNames.map((name) => [
      name,
      {
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [],
      },
    ]),
  ),
});

// `satisfies` pins each builder's return to the schema's input shape, so a
// fixture mistake (renamed field, missing required key) is a compile error
// at the builder rather than a runtime parse failure inside a test. Param
// arrays are mutable — Zod's inferred input shape is mutable, and shallow
// spreads at the call sites keep callers unaware of the distinction.
const gridChartRequest = (overrides: {
  instances?: InstanceLiteral[];
  vessels?: Array<ReturnType<typeof minimalVessel>>;
  positions?: Array<{ instanceId: string }>;
}) =>
  ({
    type: 'chart_request' as const,
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'show calendar' }],
      chartDimensions: { rows: 12, columns: 16 },
      layoutMode: 'grid' as const,
    },
    instances: overrides.instances ?? [],
    vessels: overrides.vessels ?? [],
    layout: {
      type: 'grid' as const,
      positions: (overrides.positions ?? []).map((p) => ({
        instanceId: p.instanceId,
        position: { row: 0, column: 0 },
        size: { width: 1, height: 1 },
      })),
    },
  }) satisfies z.input<typeof ChartRequestSchema>;

// `layoutInstances` is taken at face value rather than mirroring `instances`
// — the auto-mirror would let rule 5 (subset) silently auto-pass whenever a
// caller forgot to set it, masking missing test coverage.
const tilingChartRequest = (overrides: {
  instances?: InstanceLiteral[];
  vessels?: Array<ReturnType<typeof minimalVessel>>;
  layoutInstances?: InstanceLiteral[];
  tree?: Array<string | null>;
}) =>
  ({
    type: 'chart_request' as const,
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'show calendar' }],
      chartDimensions: { rows: 12, columns: 16 },
      layoutMode: 'tiling' as const,
    },
    instances: overrides.instances ?? [],
    vessels: overrides.vessels ?? [],
    layout: {
      type: 'tiling' as const,
      tree: overrides.tree ?? [],
      instances: overrides.layoutInstances ?? [],
    },
  }) satisfies z.input<typeof ChartRequestSchema>;

describe('ChartRequestSchema cross-validation', () => {
  describe('rule 1: layoutMode ↔ layout.type', () => {
    test('rejects layoutMode=grid with layout.type=tiling', () => {
      const req = {
        ...gridChartRequest({}),
        layout: { type: 'tiling' as const, tree: [], instances: [] },
      };
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'context.layoutMode' &&
            /layoutMode is "grid".*layout\.type is "tiling"/.test(i.message),
        ),
      ).toBe(true);
    });

    test('rejects layoutMode=tiling with layout.type=grid', () => {
      const req = {
        ...tilingChartRequest({}),
        layout: { type: 'grid' as const, positions: [] },
      };
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) => i.path.join('.') === 'context.layoutMode',
        ),
      ).toBe(true);
    });

    test('accepts layoutMode=grid with layout.type=grid', () => {
      expect(ChartRequestSchema.safeParse(gridChartRequest({})).success).toBe(
        true,
      );
    });

    test('accepts layoutMode=tiling with layout.type=tiling', () => {
      expect(ChartRequestSchema.safeParse(tilingChartRequest({})).success).toBe(
        true,
      );
    });
  });

  describe('layout discriminator (rejects shape ambiguity)', () => {
    test('rejects a layout missing the type discriminator', () => {
      const req = {
        ...gridChartRequest({}),
        layout: { positions: [] },
      };
      expect(ChartRequestSchema.safeParse(req).success).toBe(false);
    });

    test('rejects an unknown layout.type value', () => {
      const req = {
        ...gridChartRequest({}),
        layout: { type: 'flex', positions: [] },
      };
      expect(ChartRequestSchema.safeParse(req).success).toBe(false);
    });

    test('parses unambiguously when type=grid is set, even with stray tiling fields', () => {
      const req = {
        ...gridChartRequest({}),
        layout: {
          type: 'grid' as const,
          positions: [],
          // Stray tiling-only fields are stripped by the discriminated-union
          // arm; the discriminator pins the variant.
          tree: [],
          instances: [],
        },
      };
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect('tree' in result.data.layout).toBe(false);
      expect('instances' in result.data.layout).toBe(false);
    });

    test('parses unambiguously when type=tiling is set, even with stray grid fields', () => {
      const req = {
        ...tilingChartRequest({}),
        layout: {
          type: 'tiling' as const,
          tree: [],
          instances: [],
          positions: [],
        },
      };
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect('positions' in result.data.layout).toBe(false);
    });
  });

  describe('rule 2: instance.vesselId must exist in vessels', () => {
    test('rejects an instance referencing a missing vessel', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        vessels: [],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'instances.0.vesselId' &&
            /calendar/.test(i.message),
        ),
      ).toBe(true);
    });

    test('emits one issue per broken instance with correct indexing', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
          { instanceId: 'tasks-1', vesselId: 'tasks', variant: 'default' },
        ],
        vessels: [],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      const vesselIssuePaths = result.error.issues
        .filter((i) => /vesselId/.test(i.path.join('.')))
        .map((i) => i.path.join('.'));
      expect(vesselIssuePaths).toEqual([
        'instances.0.vesselId',
        'instances.1.vesselId',
      ]);
    });

    test('accepts an instance whose vessel is registered', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        vessels: [minimalVessel('calendar', ['default'])],
        positions: [{ instanceId: 'cal-1' }],
      });
      expect(ChartRequestSchema.safeParse(req).success).toBe(true);
    });
  });

  describe("rule 3: instance.variant must exist in vessel's variants", () => {
    test('rejects an instance with a variant the vessel does not declare', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'detail' },
        ],
        vessels: [minimalVessel('calendar', ['default'])],
        positions: [{ instanceId: 'cal-1' }],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'instances.0.variant' &&
            // Pin the input-side `Instance` label to distinguish from the
            // tiling layout-side `Layout instance` label that the same
            // `checkVesselVariantRef` helper emits.
            /Instance "cal-1".*variant "detail"/.test(i.message),
        ),
      ).toBe(true);
    });

    // Without `Object.hasOwn`, the `in` operator walks the prototype chain
    // and a variant name colliding with `Object.prototype` (e.g. `'toString'`,
    // `'__proto__'`, `'constructor'`, `'hasOwnProperty'`) would silently
    // resolve and bypass the rule, letting downstream code dereference an
    // inherited method as if it were a variant.
    test.each([
      'toString',
      '__proto__',
      'constructor',
      'hasOwnProperty',
      'valueOf',
    ])('rejects variant=%s (Object.prototype member)', (variant) => {
      const req = gridChartRequest({
        instances: [{ instanceId: 'cal-1', vesselId: 'calendar', variant }],
        vessels: [minimalVessel('calendar', ['default'])],
        positions: [{ instanceId: 'cal-1' }],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) => i.path.join('.') === 'instances.0.variant',
        ),
      ).toBe(true);
    });

    test('does not check variant when vessel itself is missing', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'detail' },
        ],
        vessels: [],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      const variantIssues = result.error.issues.filter(
        (i) => i.path.join('.') === 'instances.0.variant',
      );
      expect(variantIssues).toHaveLength(0);
    });
  });

  describe('rule 4: grid positions reference existing instances', () => {
    test('rejects a position pointing at an unknown instance', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        vessels: [minimalVessel('calendar', ['default'])],
        positions: [{ instanceId: 'ghost-1' }],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'layout.positions.0.instanceId' &&
            /ghost-1/.test(i.message),
        ),
      ).toBe(true);
    });

    test('accepts positions whose instanceIds are all in instances', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        vessels: [minimalVessel('calendar', ['default'])],
        positions: [{ instanceId: 'cal-1' }],
      });
      expect(ChartRequestSchema.safeParse(req).success).toBe(true);
    });
  });

  describe('rule 5: tiling layout.instances must include all input instances', () => {
    test('rejects when an input instance is missing from layout.instances', () => {
      const req = tilingChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        vessels: [minimalVessel('calendar', ['default'])],
        layoutInstances: [],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'instances.0.instanceId' &&
            /cal-1/.test(i.message),
        ),
      ).toBe(true);
    });

    test('accepts extras in layout.instances beyond input instances', () => {
      const req = tilingChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        vessels: [
          minimalVessel('calendar', ['default']),
          minimalVessel('tasks', ['default']),
        ],
        layoutInstances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
          { instanceId: 'tasks-1', vesselId: 'tasks', variant: 'default' },
        ],
      });
      expect(ChartRequestSchema.safeParse(req).success).toBe(true);
    });
  });

  describe('rule 6: duplicate vesselId in vessels', () => {
    test('rejects two vessels with the same id at the indexed path', () => {
      const req = gridChartRequest({
        vessels: [
          minimalVessel('calendar', ['default']),
          minimalVessel('calendar', ['default']),
        ],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'vessels.1.id' &&
            /Duplicate vessel id "calendar"/.test(i.message),
        ),
      ).toBe(true);
    });
  });

  describe('rule 7: duplicate instanceId in instances', () => {
    test('rejects two instances with the same instanceId at the second occurrence', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        vessels: [minimalVessel('calendar', ['default'])],
        positions: [{ instanceId: 'cal-1' }],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'instances.1.instanceId' &&
            /Duplicate instance id "cal-1"/.test(i.message),
        ),
      ).toBe(true);
    });
  });

  describe('rule 8: duplicate instanceId in tiling layout.instances', () => {
    test('rejects duplicate ids in layout.instances at the indexed path', () => {
      const req = tilingChartRequest({
        instances: [],
        vessels: [minimalVessel('calendar', ['default'])],
        layoutInstances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'layout.instances.1.instanceId' &&
            /Duplicate layout\.instances id "cal-1"/.test(i.message),
        ),
      ).toBe(true);
    });
  });

  describe('rule 9: duplicate instanceId in grid layout.positions', () => {
    test('rejects two positions referencing the same instance', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        vessels: [minimalVessel('calendar', ['default'])],
        positions: [{ instanceId: 'cal-1' }, { instanceId: 'cal-1' }],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'layout.positions.1.instanceId' &&
            /Duplicate grid position for instanceId "cal-1"/.test(i.message),
        ),
      ).toBe(true);
    });
  });

  describe('rule 10: layout.instances must reference valid vessel + variant', () => {
    test('rejects a layout.instances entry with an unknown vesselId', () => {
      const req = tilingChartRequest({
        instances: [],
        vessels: [minimalVessel('calendar', ['default'])],
        layoutInstances: [
          { instanceId: 'ghost-1', vesselId: 'unknown', variant: 'default' },
        ],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'layout.instances.0.vesselId' &&
            /Layout instance "ghost-1".*unknown.*"unknown"/.test(i.message),
        ),
      ).toBe(true);
    });

    test('rejects a layout.instances entry with an unknown variant', () => {
      const req = tilingChartRequest({
        instances: [],
        vessels: [minimalVessel('calendar', ['default'])],
        layoutInstances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'detail' },
        ],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'layout.instances.0.variant' &&
            /Layout instance "cal-1".*variant "detail"/.test(i.message),
        ),
      ).toBe(true);
    });
  });

  describe('rule 11: tiling tree leaves must be declared in layout.instances', () => {
    test('rejects a tree leaf that does not appear in layout.instances', () => {
      const req = tilingChartRequest({
        instances: [],
        vessels: [minimalVessel('calendar', ['default'])],
        layoutInstances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        tree: ['cal-1', 'ghost-leaf'],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(
        result.error.issues.some(
          (i) =>
            i.path.join('.') === 'layout.tree.1' &&
            /Tiling tree leaf "ghost-leaf"/.test(i.message),
        ),
      ).toBe(true);
    });

    test('accepts H/V/null tree nodes without flagging', () => {
      const req = tilingChartRequest({
        instances: [],
        vessels: [minimalVessel('calendar', ['default'])],
        layoutInstances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        tree: ['V', 'cal-1', 'H', null],
      });
      expect(ChartRequestSchema.safeParse(req).success).toBe(true);
    });
  });

  describe('multi-rule coherence failures surface together', () => {
    test('a payload that breaks vessel + variant + grid-position rules emits issues for each', () => {
      const req = gridChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'unknown', variant: 'default' },
          { instanceId: 'tasks-1', vesselId: 'tasks', variant: 'unknown' },
        ],
        vessels: [minimalVessel('tasks', ['default'])],
        positions: [{ instanceId: 'ghost-1' }],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');

      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('instances.0.vesselId');
      expect(paths).toContain('instances.1.variant');
      expect(paths).toContain('layout.positions.0.instanceId');
    });

    test('rule 1 (mode mismatch) does not short-circuit the layout-side checks', () => {
      // layoutMode=tiling + layout.type=grid with a ghost position: rule 1
      // fires AND rule 4 (grid position existence) fires. The contract is
      // that callers learn about every problem in a single parse pass.
      const req = {
        ...tilingChartRequest({}),
        layout: {
          type: 'grid' as const,
          positions: [
            {
              instanceId: 'ghost-1',
              position: { row: 0, column: 0 },
              size: { width: 1, height: 1 },
            },
          ],
        },
      };
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('context.layoutMode');
      expect(paths).toContain('layout.positions.0.instanceId');
    });

    test('a tiling payload breaking layout.instances coherence + subset + tree-leaf rules emits all three', () => {
      const req = tilingChartRequest({
        instances: [
          { instanceId: 'cal-1', vesselId: 'calendar', variant: 'default' },
        ],
        vessels: [minimalVessel('calendar', ['default'])],
        layoutInstances: [
          { instanceId: 'tasks-1', vesselId: 'unknown', variant: 'default' },
        ],
        tree: ['ghost-leaf'],
      });
      const result = ChartRequestSchema.safeParse(req);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('layout.instances.0.vesselId');
      expect(paths).toContain('instances.0.instanceId');
      expect(paths).toContain('layout.tree.0');
    });
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
