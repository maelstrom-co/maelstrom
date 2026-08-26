import { describe, expect, test } from 'bun:test';

import { InstanceId } from './instance.js';
import {
  isTilingSplit,
  parseTilingSplitToken,
  type TilingNode,
} from './response.js';
import {
  ActionExecutionSchema,
  GridPositionSchema,
  TilingLayoutSchema,
  TilingNodeSchema,
  TilingTreeSchema,
  VesselInstanceSnapshotSchema,
} from './schemas.js';

describe('TilingNodeSchema', () => {
  test('passes bare split operators and null through unchanged', () => {
    expect(TilingNodeSchema.parse('H')).toBe('H');
    expect(TilingNodeSchema.parse('V')).toBe('V');
    expect(TilingNodeSchema.parse(null)).toBeNull();
  });

  test('brands anything else as an instance id', () => {
    expect(TilingNodeSchema.parse('calendar-main')).toBe(
      InstanceId('calendar-main'),
    );
  });

  test('passes weighted split tokens through unchanged', () => {
    expect(TilingNodeSchema.parse('V:1,1,1')).toBe('V:1,1,1');
    expect(TilingNodeSchema.parse('H:2,1')).toBe('H:2,1');
  });

  test('passes axis-prefixed tokens with malformed weights through as splits', () => {
    // Rejecting here would cost a model round trip; branding as an instance
    // id would report an undeclared leaf instead of a bad weight.
    for (const token of ['V:', 'H:abc', 'V:1,,2'] as const) {
      expect(TilingNodeSchema.parse(token)).toBe(token);
      expect(isTilingSplit(TilingNodeSchema.parse(token))).toBe(true);
    }
  });

  test('an id that merely starts with an axis letter is still a leaf', () => {
    expect(TilingNodeSchema.parse('Header')).toBe(InstanceId('Header'));
    expect(TilingNodeSchema.parse('Vessel-1')).toBe(InstanceId('Vessel-1'));
  });

  test('the split and instance-id arms cannot overlap', () => {
    // A leaf named "H:main" would be branded a split token here, read as an
    // arity-two divider, and made to consume the two subtrees that follow —
    // while the instance it names is reported as never referenced. The
    // namespace is reserved at the declaration boundary instead.
    for (const reserved of ['H', 'V', 'H:main', 'V:sidebar'] as const) {
      expect(TilingNodeSchema.parse(reserved)).toBe(reserved);
      expect(() => InstanceId(reserved)).toThrow(/reserved/);
      expect(
        VesselInstanceSnapshotSchema.safeParse({
          instanceId: reserved,
          vesselId: 'calendar',
          variant: 'month',
        }).success,
      ).toBe(false);
    }
  });

  test('declares an instance whose id merely starts with an axis letter', () => {
    expect(
      VesselInstanceSnapshotSchema.parse({
        instanceId: 'Header',
        vesselId: 'calendar',
        variant: 'month',
      }).instanceId,
    ).toBe(InstanceId('Header'));
  });

  test('rejects the empty string', () => {
    expect(TilingNodeSchema.safeParse('').success).toBe(false);
  });
});

describe('TilingTreeSchema', () => {
  test('an existing unweighted payload parses unchanged', () => {
    const tree: TilingNode[] = [
      'H',
      InstanceId('calendar-1'),
      'V',
      InstanceId('weather-1'),
      null,
    ];
    expect(TilingTreeSchema.parse(tree)).toEqual(tree);
  });

  test('a weighted payload parses unchanged', () => {
    const tree: TilingNode[] = [
      'H:1,1,1',
      'V:2,1',
      InstanceId('a'),
      InstanceId('b'),
      InstanceId('c'),
      InstanceId('d'),
    ];
    expect(TilingTreeSchema.parse(tree)).toEqual(tree);
  });

  test('the model-facing description teaches the arity rule', () => {
    // Read through TilingLayoutSchema, which is what request.ts and
    // envelope.ts build the model-facing schema from. Zod's `.describe()`
    // replaces rather than appends, so a description pinned on
    // TilingTreeSchema alone would pass this test while reaching no model.
    const described = TilingLayoutSchema.shape.tree.description ?? '';
    expect(described).toContain('weights');
    expect(described).toContain('V:1,1,1');
    expect(described).toContain('AT MOST ONCE');
    expect(described).toContain(
      '["H:1,1,1", "V:1,1,1", a, b, c, "V:1,1,1", d, e, f, "V:1,1,1", g, h, i]',
    );
  });

  test('parsed split tokens are readable by the grammar parser', () => {
    const [token] = TilingTreeSchema.parse(['V:1,2,3', 'a', 'b', 'c']);
    expect(parseTilingSplitToken(token ?? null)).toEqual({
      axis: 'V',
      weights: [1, 2, 3],
      repaired: false,
      discardedChildCount: 0,
    });
  });
});

describe('reserved instance ids across every branding schema', () => {
  const reserved = ['H', 'V', 'H:main', 'V:sidebar'] as const;

  test('ActionExecutionSchema reports an issue instead of throwing', () => {
    for (const instanceId of reserved) {
      const result = ActionExecutionSchema.safeParse({
        instanceId,
        action: 'open',
      });
      expect(result.success).toBe(false);
    }
  });

  test('GridPositionSchema reports an issue instead of throwing', () => {
    for (const instanceId of reserved) {
      const result = GridPositionSchema.safeParse({
        instanceId,
        position: { row: 0, column: 0 },
        size: { width: 1, height: 1 },
      });
      expect(result.success).toBe(false);
    }
  });

  test('an id that merely starts with an axis letter still brands', () => {
    const result = ActionExecutionSchema.safeParse({
      instanceId: 'Header',
      action: 'open',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.instanceId).toBe(InstanceId('Header'));
  });
});
