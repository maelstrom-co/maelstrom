import { describe, expect, test } from 'bun:test';
import {
  ActionName,
  InstanceId,
  VariantName,
  VesselId,
  type Vessel,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { silentLogger } from '../../__test-helpers__/fixtures.js';
import { parseExecutionPlan } from './parse-execution-plan.js';
import type { RawActionExecution } from './validation-context.js';

// Two-action plan whose validity depends on the writer mutating between
// iterations: action #2's `expand` is only valid on variant `expanded`,
// which #1's `goExpanded` transitions the instance into. If `parseExecutionPlan`
// reordered, batched, or otherwise lost the writer→reader hand-off across
// iterations, the second action would be skipped as `action_not_valid`.
describe('parseExecutionPlan — sequential simulation hand-off', () => {
  const panelVesselId = 'panel' as VesselId;
  const collapsed = 'collapsed' as VariantName;
  const expanded = 'expanded' as VariantName;
  const goExpanded = 'goExpanded' as ActionName;
  const expandAction = 'expand' as ActionName;
  const instanceId = InstanceId('panel-1');

  const panelVessel: Vessel = {
    id: panelVesselId,
    name: 'Panel',
    description: 'Stateful panel',
    defaultVariant: collapsed,
    variants: {
      [collapsed]: {
        description: 'Collapsed',
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          {
            name: goExpanded,
            description: 'Move to expanded',
            transitionsTo: expanded,
          },
        ],
      },
      [expanded]: {
        description: 'Expanded',
        props: {},
        minSize: { width: 2, height: 2 },
        actions: [
          {
            name: expandAction,
            description: 'Re-expand (idempotent)',
          },
        ],
      },
    },
  } as unknown as Vessel;

  const initialInstance: VesselInstanceSnapshot = {
    instanceId,
    vesselId: panelVesselId,
    variant: collapsed,
  };

  test('writer mutations from action #1 are visible to resolveAction for action #2', () => {
    const plan: RawActionExecution[] = [
      { instanceId, action: goExpanded },
      { instanceId, action: expandAction },
    ];

    const { plan: result, skippedActions } = parseExecutionPlan(
      plan,
      [initialInstance],
      [panelVessel],
      silentLogger,
    );

    // Both actions accepted: the second resolves against the variant the
    // first transitioned the instance into. If the simulation state didn't
    // mutate between iterations, the second action's `expand` would not
    // exist on the `collapsed` variant and would be skipped.
    expect(skippedActions).toEqual([]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ instanceId, action: goExpanded });
    expect(result[1]).toEqual({ instanceId, action: expandAction });
  });

  test('reverse order surfaces the dependency: action #2-as-#1 is rejected', () => {
    // Sanity check on the test's invariant: with the order swapped, `expand`
    // is the first action and the simulated variant is still `collapsed`,
    // so it must be skipped as not-valid. This pins the hand-off itself
    // (rather than some other invariant) as the load-bearing behaviour.
    const plan: RawActionExecution[] = [
      { instanceId, action: expandAction },
      { instanceId, action: goExpanded },
    ];

    const { plan: result, skippedActions } = parseExecutionPlan(
      plan,
      [initialInstance],
      [panelVessel],
      silentLogger,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ instanceId, action: goExpanded });
    expect(skippedActions).toHaveLength(1);
    expect(skippedActions[0]).toMatchObject({
      reason: 'action_not_valid',
      action: expandAction,
    });
  });
});
