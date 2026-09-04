import { describe, expect, test } from 'bun:test';

import { InstanceId } from './instance.js';
import {
  isTilingSplit,
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
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

  test('passes a prefixed leaf through unchanged', () => {
    expect(TilingNodeSchema.parse('ID:calendar-main')).toBe('ID:calendar-main');
  });

  test('passes weighted split tokens through unchanged', () => {
    expect(TilingNodeSchema.parse('V:1,1,1')).toBe('V:1,1,1');
    expect(TilingNodeSchema.parse('H:2,1')).toBe('H:2,1');
  });

  test('passes axis-prefixed tokens with malformed weights through as splits', () => {
    // Rejecting here would cost a model round trip over a defect the tree's
    // shape survives: the arity is repaired downstream.
    for (const token of ['V:', 'H:abc', 'V:1,,2'] as const) {
      expect(TilingNodeSchema.parse(token)).toBe(token);
      expect(isTilingSplit(TilingNodeSchema.parse(token))).toBe(true);
    }
  });

  test('a leaf whose id starts with an axis letter is still a leaf', () => {
    expect(TilingNodeSchema.parse('ID:Header')).toBe('ID:Header');
    expect(TilingNodeSchema.parse('ID:Vessel-1')).toBe('ID:Vessel-1');
  });

  test('the prefix keeps a split-shaped instance id readable as a leaf', () => {
    for (const instanceId of ['H', 'V', 'H:main', 'V:sidebar'] as const) {
      const node = TilingNodeSchema.parse(`ID:${instanceId}`);
      expect(isTilingSplit(node)).toBe(false);
      expect(tilingLeafInstanceId(node)).toBe(InstanceId(instanceId));
    }
  });

  test('rejects a leaf written without the prefix', () => {
    for (const bare of ['calendar-main', 'Header', 'a'] as const) {
      const result = TilingNodeSchema.safeParse(bare);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('ID:');
    }
  });

  test('rejects the bare prefix, which names no instance', () => {
    expect(TilingNodeSchema.safeParse('ID:').success).toBe(false);
  });

  test('rejects the empty string', () => {
    expect(TilingNodeSchema.safeParse('').success).toBe(false);
  });

  test('reports a rejected node as an issue rather than throwing', () => {
    expect(() => TilingNodeSchema.safeParse('calendar-main')).not.toThrow();
  });
});

describe('TilingTreeSchema', () => {
  test('an unweighted payload parses unchanged', () => {
    const tree: TilingNode[] = [
      'H',
      'ID:calendar-1',
      'V',
      'ID:weather-1',
      null,
    ];
    expect(TilingTreeSchema.parse(tree)).toEqual(tree);
  });

  test('a weighted payload parses unchanged', () => {
    const tree: TilingNode[] = [
      'H:1,1,1',
      'V:2,1',
      'ID:a',
      'ID:b',
      'ID:c',
      'ID:d',
    ];
    expect(TilingTreeSchema.parse(tree)).toEqual(tree);
  });

  test('one unprefixed leaf rejects the whole tree', () => {
    const result = TilingTreeSchema.safeParse(['V', 'ID:a', 'b']);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([2]);
  });

  test('the model-facing description teaches the arity and prefix rules', () => {
    // Read through TilingLayoutSchema, which is what request.ts and
    // envelope.ts build the model-facing schema from. Zod's `.describe()`
    // replaces rather than appends, so a description pinned on
    // TilingTreeSchema alone would pass this test while reaching no model.
    const described = TilingLayoutSchema.shape.tree.description ?? '';
    expect(described).toContain('weights');
    expect(described).toContain('V:1,1,1');
    expect(described).toContain('AT MOST ONCE');
    expect(described).toContain('"ID:" followed by an instance ID');
    expect(described).toContain(
      '["H:1,1,1", "V:1,1,1", "ID:a", "ID:b", "ID:c", "V:1,1,1", "ID:d", "ID:e", "ID:f", "V:1,1,1", "ID:g", "ID:h", "ID:i"]',
    );
  });

  test('the node description teaches the prefix rule too', () => {
    const described = TilingLayoutSchema.shape.tree.element.description ?? '';
    expect(described).toContain('"ID:"');
    expect(described).toContain('never a bare "calendar-main"');
  });

  test('parsed split tokens are readable by the grammar parser', () => {
    const [token] = TilingTreeSchema.parse(['V:1,2,3', 'ID:a', 'ID:b', 'ID:c']);
    expect(parseTilingSplitToken(token ?? null)).toEqual({
      axis: 'V',
      weights: [1, 2, 3],
      repaired: false,
      repairReason: null,
      discardedChildCount: 0,
    });
  });
});

describe('split-shaped instance ids across every branding schema', () => {
  // The tiling grammar marks its leaves, so it reserves no part of the
  // Instance ID namespace for itself.
  const splitShaped = ['H', 'V', 'H:main', 'V:sidebar'] as const;

  test('ActionExecutionSchema brands them', () => {
    for (const instanceId of splitShaped) {
      const result = ActionExecutionSchema.safeParse({
        instanceId,
        action: 'open',
      });
      expect(result.success).toBe(true);
      expect(result.data?.instanceId).toBe(InstanceId(instanceId));
    }
  });

  test('GridPositionSchema brands them', () => {
    for (const instanceId of splitShaped) {
      const result = GridPositionSchema.safeParse({
        instanceId,
        position: { row: 0, column: 0 },
        size: { width: 1, height: 1 },
      });
      expect(result.success).toBe(true);
      expect(result.data?.instanceId).toBe(InstanceId(instanceId));
    }
  });

  test('VesselInstanceSnapshotSchema brands them', () => {
    for (const instanceId of splitShaped) {
      const result = VesselInstanceSnapshotSchema.safeParse({
        instanceId,
        vesselId: 'calendar',
        variant: 'month',
      });
      expect(result.success).toBe(true);
      expect(result.data?.instanceId).toBe(InstanceId(instanceId));
    }
  });

  test('the InstanceId factory brands them', () => {
    for (const instanceId of splitShaped) {
      expect(InstanceId(instanceId)).toBe(instanceId as InstanceId);
    }
  });

  test('an empty instance id is still refused', () => {
    expect(() => InstanceId('')).toThrow();
  });
});
