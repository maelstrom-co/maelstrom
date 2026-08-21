import { describe, expect, test } from 'bun:test';

import { InstanceId } from './instance.js';
import {
  isTilingSplit,
  parseTilingSplitToken,
  type TilingNode,
} from './response.js';
import { TilingNodeSchema, TilingTreeSchema } from './schemas.js';

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
    const described = TilingTreeSchema.description ?? '';
    expect(described).toContain('weights');
    expect(described).toContain('V:1,1,1');
  });

  test('parsed split tokens are readable by the grammar parser', () => {
    const [token] = TilingTreeSchema.parse(['V:1,2,3', 'a', 'b', 'c']);
    expect(parseTilingSplitToken(token ?? null)).toEqual({
      axis: 'V',
      weights: [1, 2, 3],
      repaired: false,
    });
  });
});
