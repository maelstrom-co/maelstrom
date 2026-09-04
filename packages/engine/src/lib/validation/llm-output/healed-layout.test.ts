import { describe, expect, test } from 'bun:test';
import { InstanceId, VariantName, VesselId } from '@maelstrom-co/protocol';

import { invalid } from '../../__test-helpers__/fixtures.js';
import type { DroppedLayoutEntry, LayoutWarning } from './healed-layout.js';
import {
  formatDroppedEntry,
  formatLayoutWarning,
  formatLayoutWarnings,
  isTreeDrop,
} from './healed-layout.js';

// ---------------------------------------------------------------------------
// formatDroppedEntry — exhaustiveness lock for the DroppedLayoutEntry union.
// Adding a new arm without updating the switch breaks the build via the
// `assertNever` default; this test pins the runtime mapping per arm.
// ---------------------------------------------------------------------------

describe('formatDroppedEntry', () => {
  test.each<[DroppedLayoutEntry, string]>([
    [
      { reason: 'unknown_instance', instanceId: InstanceId('ghost') },
      'instance "ghost" not in request',
    ],
    [
      {
        reason: 'unknown_vessel',
        instanceId: InstanceId('orphan'),
        vesselId: VesselId('no-such'),
      },
      'instance "orphan" referenced unknown vessel "no-such"',
    ],
    [
      {
        reason: 'unknown_variant',
        instanceId: InstanceId('wgt'),
        variant: VariantName('gone'),
      },
      'instance "wgt" referenced unknown variant "gone"',
    ],
    [
      {
        reason: 'position_overflow',
        instanceId: InstanceId('a'),
        row: 10,
        column: 5,
        width: 4,
        height: 3,
        chartColumns: 12,
        chartRows: 8,
      },
      'instance "a" at (10,5) size 4x3 exceeds chart bounds (12x8)',
    ],
    [
      {
        reason: 'size_below_minimum',
        instanceId: InstanceId('small'),
        width: 1,
        height: 1,
        minWidth: 4,
        minHeight: 3,
      },
      'instance "small" size 1x1 below variant minimum 4x3',
    ],
    [
      { reason: 'duplicate_instance_id', instanceId: InstanceId('dupe') },
      'instance "dupe" appeared multiple times in layout',
    ],
    [
      { reason: 'tree_missing_child', atTokenIndex: 7 },
      'tiling tree split at token index 7 is missing a child',
    ],
    [
      {
        reason: 'tree_duplicate_leaf',
        atTokenIndex: 2,
        instanceId: InstanceId('dupe'),
      },
      'tiling tree references instance "dupe" more than once, at token index 2',
    ],
    [
      {
        reason: 'tree_orphan_reference',
        atTokenIndex: 5,
        instanceId: InstanceId('lost'),
      },
      'tiling tree references unknown instance "lost" at token index 5',
    ],
    [
      { reason: 'tree_extra_tokens', fromTokenIndex: 10, count: 2 },
      'tiling tree has 2 unconsumed token(s) from index 10',
    ],
    [
      {
        reason: 'tree_split_truncated',
        atTokenIndex: 0,
        declaredChildCount: 20,
        keptChildCount: 12,
      },
      'tiling tree split at token index 0 declared 20 children, cut to 12',
    ],
  ])('formats %p', (entry, expected) => {
    expect(formatDroppedEntry(entry)).toBe(expected);
  });

  test('throws on an entry with an unrecognized reason (assertNever default)', () => {
    // The whole point of the assertNever default is to fail loudly when
    // someone bypasses the discriminator at runtime. This test simulates
    // that breach via an unsafe cast and asserts the throw fires.
    const rogue = invalid<DroppedLayoutEntry>({
      reason: 'this_arm_does_not_exist',
      instanceId: 'x',
    });
    expect(() => formatDroppedEntry(rogue)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// isTreeDrop — narrows TreeDroppedLayoutEntry from the parent union.
// ---------------------------------------------------------------------------

describe('isTreeDrop', () => {
  test.each<[DroppedLayoutEntry, boolean]>([
    [{ reason: 'tree_missing_child', atTokenIndex: 0 }, true],
    [
      {
        reason: 'tree_orphan_reference',
        atTokenIndex: 0,
        instanceId: InstanceId('a'),
      },
      true,
    ],
    [{ reason: 'tree_extra_tokens', fromTokenIndex: 0, count: 1 }, true],
    [
      {
        reason: 'tree_duplicate_leaf',
        atTokenIndex: 0,
        instanceId: InstanceId('a'),
      },
      true,
    ],
    [
      {
        reason: 'tree_split_truncated',
        atTokenIndex: 0,
        declaredChildCount: 13,
        keptChildCount: 12,
      },
      true,
    ],
    [{ reason: 'unknown_instance', instanceId: InstanceId('a') }, false],
    [
      {
        reason: 'unknown_vessel',
        instanceId: InstanceId('a'),
        vesselId: VesselId('v'),
      },
      false,
    ],
    [
      {
        reason: 'unknown_variant',
        instanceId: InstanceId('a'),
        variant: VariantName('v'),
      },
      false,
    ],
    [
      {
        reason: 'position_overflow',
        instanceId: InstanceId('a'),
        row: 0,
        column: 0,
        width: 1,
        height: 1,
        chartColumns: 1,
        chartRows: 1,
      },
      false,
    ],
    [
      {
        reason: 'size_below_minimum',
        instanceId: InstanceId('a'),
        width: 1,
        height: 1,
        minWidth: 2,
        minHeight: 2,
      },
      false,
    ],
    [{ reason: 'duplicate_instance_id', instanceId: InstanceId('a') }, false],
  ])('returns %p for entry %p', (entry, expected) => {
    expect(isTreeDrop(entry)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatLayoutWarning — exhaustiveness lock for the LayoutWarning union, the
// same guard formatDroppedEntry provides for drops. A repair is a rewrite of
// model output, so an arm nobody renders is a mutation nobody can see.
// ---------------------------------------------------------------------------

describe('formatLayoutWarning', () => {
  test.each<[LayoutWarning, string]>([
    [{ kind: 'missing_rationale' }, 'response omitted its rationale'],
    [
      {
        kind: 'split_weights_repaired',
        atTokenIndex: 4,
        token: 'V:xyz',
        weights: [1, 1],
        repairReason: 'unreadable',
      },
      'tiling tree split token "V:xyz" at token index 4 had an unreadable weight suffix, read as 1,1',
    ],
    [
      {
        kind: 'split_weights_repaired',
        atTokenIndex: 0,
        token: 'V:1,1,1,1,1,1,1,1,1,1,1,1,1,1',
        weights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        repairReason: 'truncated',
      },
      'tiling tree split token "V:1,1,1,1,1,1,1,1,1,1,1,1,1,1" at token index 0 declared more children than a split may hold, read as 1,1,1,1,1,1,1,1,1,1,1,1',
    ],
    [
      {
        kind: 'split_weights_repaired',
        atTokenIndex: 2,
        token: 'V:5',
        weights: [5, 1],
        repairReason: 'padded',
      },
      'tiling tree split token "V:5" at token index 2 declared fewer than the two weights a split needs, read as 5,1',
    ],
  ])('formats %p', (warning, expected) => {
    expect(formatLayoutWarning(warning)).toBe(expected);
  });

  test('throws on a warning with an unrecognized kind (assertNever default)', () => {
    const rogue = invalid<LayoutWarning>({ kind: 'this_arm_does_not_exist' });
    expect(() => formatLayoutWarning(rogue)).toThrow();
  });

  test('a token carrying control characters cannot forge a log line', () => {
    // The token is model-authored and reaches the operator log verbatim, so
    // newlines and escapes would let one repair write log lines of its own.
    const line = formatLayoutWarning({
      kind: 'split_weights_repaired',
      atTokenIndex: 0,
      token: 'V:1\n[engine] forged line\u001b[31m',
      weights: [1, 1],
      repairReason: 'unreadable',
    });

    expect(line).not.toContain('\n');
    expect(line).not.toContain('\u001b');
    expect(line).toContain('\uFFFD');
  });

  test('an unbounded token is truncated before it reaches the log', () => {
    const line = formatLayoutWarning({
      kind: 'split_weights_repaired',
      atTokenIndex: 0,
      token: `V:${'1'.repeat(5_000)}`,
      weights: [1, 1],
      repairReason: 'unreadable',
    });

    expect(line).toContain('…[truncated]');
    expect(line.length).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------
// formatLayoutWarnings — the bounded operator-log view. One entry per
// malformed split token in a model-sized tree, so the array needs a ceiling
// of its own.
// ---------------------------------------------------------------------------

describe('formatLayoutWarnings', () => {
  test('renders every warning when the list is short', () => {
    expect(
      formatLayoutWarnings([
        { kind: 'missing_rationale' },
        { kind: 'missing_rationale' },
      ]),
    ).toEqual([
      'response omitted its rationale',
      'response omitted its rationale',
    ]);
  });

  test('caps the list and reports how many were omitted', () => {
    const warnings: LayoutWarning[] = Array.from({ length: 20 }, () => ({
      kind: 'missing_rationale' as const,
    }));

    const lines = formatLayoutWarnings(warnings);

    expect(lines).toHaveLength(17);
    expect(lines.at(-1)).toBe('4 additional warnings omitted');
  });

  test('renders no list at all for no warnings', () => {
    expect(formatLayoutWarnings([])).toEqual([]);
  });
});
