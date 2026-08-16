import { describe, expect, test } from 'bun:test';
import {
  ActionName,
  InstanceId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import type { SkippedAction } from '../../response/execution-plan/index.js';
import { deriveRetryHint } from './retry-hint.js';

const instanceId = InstanceId('inst-1');
const vesselId = VesselId('v');
const variant = VariantName('a');
const action = ActionName('doIt');

const skip = (reason: SkippedAction['reason']): SkippedAction => {
  switch (reason) {
    case 'unknown_instance':
      return { reason, instanceId, action };
    case 'unknown_vessel':
      return { reason, instanceId, action, vesselId };
    case 'no_simulated_variant':
      return { reason, instanceId, action };
    case 'variant_not_on_vessel':
      return { reason, instanceId, action, vesselId, variant };
    case 'action_not_valid':
      return {
        reason,
        instanceId,
        action,
        vesselId,
        variant,
        validActions: [],
      };
    case 'params_parse_failed':
      return { reason, instanceId, action };
    case 'params_validation_failed':
      return {
        reason,
        instanceId,
        action,
        issues: [{ kind: 'missing_parameter', parameter: 'label' }],
      };
    case 'state_drift':
      return { reason, instanceId, action, vesselId, targetVariant: variant };
    case 'self_transition_noop':
      return { reason, instanceId, action, vesselId, currentVariant: variant };
  }
};

describe('deriveRetryHint', () => {
  describe('per-reason fixability classification', () => {
    // Table over every SkippedAction reason. A new reason that lands without
    // an entry here trips the type-system exhaustiveness check in `skip()`
    // above, and adding it without classifying it surfaces here as a missing
    // row. The rule under test: when the skip is the ONLY input (one
    // proposed action, none accepted, no layout drops, non-empty layout),
    // does deriveRetryHint recommend retry?
    test.each([
      ['unknown_instance' as const, true],
      ['unknown_vessel' as const, true],
      ['no_simulated_variant' as const, true],
      ['variant_not_on_vessel' as const, true],
      ['action_not_valid' as const, true],
      ['params_parse_failed' as const, true],
      ['params_validation_failed' as const, true],
      ['state_drift' as const, false],
      ['self_transition_noop' as const, false],
    ])('skip reason %p → recommend = %p', (reason, expectedRecommend) => {
      const hint = deriveRetryHint({
        healedLayoutSize: 1,
        requestInstanceCount: 1,
        proposedActionCount: 1,
        acceptedActionCount: 0,
        skippedActions: [skip(reason)],
        droppedLayoutCount: 0,
        warningCount: 0,
      });
      expect(hint.recommend).toBe(expectedRecommend);
    });
  });

  // Mixing a non-fixable skip with a fixable one must still recommend retry —
  // the fixable skip carries the chance of re-rolling into a usable plan.
  test('non-fixable + fixable mix recommends retry', () => {
    const hint = deriveRetryHint({
      healedLayoutSize: 1,
      requestInstanceCount: 1,
      proposedActionCount: 2,
      acceptedActionCount: 0,
      skippedActions: [skip('self_transition_noop'), skip('action_not_valid')],
      droppedLayoutCount: 0,
      warningCount: 0,
    });
    expect(hint.recommend).toBe(true);
    expect(hint.severity).toBe('medium');
  });

  // The layout-empty short-circuit must win over the non-fixable exemption:
  // a request that asked for instances but rendered nothing is unrecoverable
  // regardless of which skip reasons are present. A reorder bug putting
  // anySkipFixable before the empty-layout check would silently demote
  // unrecoverable cases to recommend:false.
  test('layoutEmptyWhenNeeded wins even with only non-fixable skips', () => {
    const hint = deriveRetryHint({
      healedLayoutSize: 0,
      requestInstanceCount: 1,
      proposedActionCount: 1,
      acceptedActionCount: 0,
      skippedActions: [skip('self_transition_noop')],
      droppedLayoutCount: 0,
      warningCount: 0,
    });
    expect(hint).toEqual({ severity: 'unrecoverable', recommend: true });
  });

  test('empty layout but no instances requested → not unrecoverable', () => {
    // Sanity check on the layoutEmptyWhenNeeded predicate: empty layout is
    // expected when the request itself had no instances (chat-only turn),
    // so it must NOT trigger the unrecoverable branch.
    const hint = deriveRetryHint({
      healedLayoutSize: 0,
      requestInstanceCount: 0,
      proposedActionCount: 0,
      acceptedActionCount: 0,
      skippedActions: [],
      droppedLayoutCount: 0,
      warningCount: 0,
    });
    expect(hint).toEqual({ severity: 'none', recommend: false });
  });

  test('warnings-only response → severity low, no retry', () => {
    const hint = deriveRetryHint({
      healedLayoutSize: 1,
      requestInstanceCount: 1,
      proposedActionCount: 0,
      acceptedActionCount: 0,
      skippedActions: [],
      droppedLayoutCount: 0,
      warningCount: 1,
    });
    expect(hint).toEqual({ severity: 'low', recommend: false });
  });

  test('partial accept + partial skip does not recommend retry', () => {
    // Pin: deriveRetryHint only flips recommend=true when ALL proposed
    // actions were skipped (and any are fixable). If at least one survived,
    // partial UI update is preferred over a re-roll.
    const hint = deriveRetryHint({
      healedLayoutSize: 1,
      requestInstanceCount: 1,
      proposedActionCount: 2,
      acceptedActionCount: 1,
      skippedActions: [skip('action_not_valid')],
      droppedLayoutCount: 0,
      warningCount: 0,
    });
    expect(hint.recommend).toBe(false);
    expect(hint.severity).toBe('medium');
  });
});
