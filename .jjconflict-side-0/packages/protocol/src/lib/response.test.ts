import { describe, expect, test } from 'bun:test';

import { InstanceId } from './instance.js';
import { isInstanceIdNode, isTilingSplit } from './response.js';

describe('isInstanceIdNode', () => {
  test('true for a branded instance id', () => {
    expect(isInstanceIdNode(InstanceId('widget-1'))).toBe(true);
  });

  test('false for the split operators', () => {
    expect(isInstanceIdNode('H')).toBe(false);
    expect(isInstanceIdNode('V')).toBe(false);
  });

  test('false for null', () => {
    expect(isInstanceIdNode(null)).toBe(false);
  });

  test('narrows the node to InstanceId at the type level', () => {
    const tree = [InstanceId('widget-1'), 'H' as const, null];
    const leaves = tree.filter(isInstanceIdNode);
    // Compile-time: every element of `leaves` is InstanceId.
    // Runtime: only the first element survives the filter.
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toBe(InstanceId('widget-1'));
  });
});

describe('isTilingSplit', () => {
  test('true for H and V', () => {
    expect(isTilingSplit('H')).toBe(true);
    expect(isTilingSplit('V')).toBe(true);
  });

  test('false for a branded instance id', () => {
    expect(isTilingSplit(InstanceId('widget-1'))).toBe(false);
  });

  test('false for null', () => {
    expect(isTilingSplit(null)).toBe(false);
  });
});

describe('isInstanceIdNode + isTilingSplit partition TilingNode', () => {
  test('every non-null node is classified by exactly one predicate', () => {
    const nodes = [
      InstanceId('widget-1'),
      InstanceId('calendar-main'),
      'H' as const,
      'V' as const,
    ];
    for (const node of nodes) {
      expect(isInstanceIdNode(node) !== isTilingSplit(node)).toBe(true);
    }
  });

  test('null is classified by neither', () => {
    expect(isInstanceIdNode(null)).toBe(false);
    expect(isTilingSplit(null)).toBe(false);
  });
});
