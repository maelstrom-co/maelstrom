import { describe, expect, test } from 'bun:test';
import {
  ActionName,
  InstanceId,
  VariantName,
  VesselId,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { makeVessel, silentLogger } from '../../__test-helpers__/fixtures.js';
import { parseExecutionPlan } from './parse-execution-plan.js';
import type { RawActionExecution } from './types.js';

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

  const panelVessel = makeVessel({
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
  });

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

describe('parseExecutionPlan — self-transition no-op classification', () => {
  const calendarVesselId = 'calendar' as VesselId;
  const month = 'month' as VariantName;
  const week = 'week' as VariantName;
  const day = 'day' as VariantName;
  const showMonth = 'showMonth' as ActionName;
  const showWeek = 'showWeek' as ActionName;
  const showDay = 'showDay' as ActionName;
  const calendarInstanceId = InstanceId('calendar-main');

  const calendarVessel = makeVessel({
    id: calendarVesselId,
    name: 'Calendar',
    description: 'Calendar with three views',
    defaultVariant: month,
    variants: {
      [month]: {
        description: 'Month view',
        props: {},
        minSize: { width: 4, height: 4 },
        actions: [
          {
            name: showWeek,
            description: 'Switch to week',
            transitionsTo: week,
          },
          { name: showDay, description: 'Switch to day', transitionsTo: day },
        ],
      },
      [week]: {
        description: 'Week view',
        props: {},
        minSize: { width: 4, height: 4 },
        actions: [
          {
            name: showMonth,
            description: 'Switch to month',
            transitionsTo: month,
          },
          { name: showDay, description: 'Switch to day', transitionsTo: day },
        ],
      },
      [day]: {
        description: 'Day view',
        props: {},
        minSize: { width: 4, height: 4 },
        actions: [
          {
            name: showMonth,
            description: 'Switch to month',
            transitionsTo: month,
          },
          {
            name: showWeek,
            description: 'Switch to week',
            transitionsTo: week,
          },
        ],
      },
    },
  });

  const inDayVariant: VesselInstanceSnapshot = {
    instanceId: calendarInstanceId,
    vesselId: calendarVesselId,
    variant: day,
  };

  test('action targeting the simulator current variant is classified as self_transition_noop', () => {
    const plan: RawActionExecution[] = [
      { instanceId: calendarInstanceId, action: showDay },
    ];

    const { plan: result, skippedActions } = parseExecutionPlan(
      plan,
      [inDayVariant],
      [calendarVessel],
      silentLogger,
    );

    expect(result).toHaveLength(0);
    expect(skippedActions).toHaveLength(1);
    expect(skippedActions[0]).toEqual({
      reason: 'self_transition_noop',
      instanceId: calendarInstanceId,
      action: showDay,
      vesselId: calendarVesselId,
      currentVariant: day,
    });
  });

  test('action absent from the vessel entirely still surfaces as action_not_valid (regression lock)', () => {
    // Typo / absent-from-vessel must remain re-promptable; the no-op
    // classification only fires when same-named definitions exist.
    const plan: RawActionExecution[] = [
      { instanceId: calendarInstanceId, action: 'showQuarter' as ActionName },
    ];

    const { plan: result, skippedActions } = parseExecutionPlan(
      plan,
      [inDayVariant],
      [calendarVessel],
      silentLogger,
    );

    expect(result).toHaveLength(0);
    expect(skippedActions).toHaveLength(1);
    expect(skippedActions[0]).toMatchObject({
      reason: 'action_not_valid',
      action: 'showQuarter',
    });
  });

  test('ambiguous action on multiple variants (some target current variant, some do not) → action_not_valid', () => {
    // The protocol permits the same action name on multiple variants with
    // different transitionsTo. If even one same-named definition points
    // elsewhere the LLM may have meant that one — exempting from retry
    // would silently suppress a fixable mistake.
    const ambiguousVessel = makeVessel({
      id: calendarVesselId,
      name: 'Calendar',
      description: 'Calendar with ambiguous showWeek action',
      defaultVariant: month,
      variants: {
        [month]: {
          props: {},
          minSize: { width: 4, height: 4 },
          actions: [
            {
              name: showWeek,
              description: 'Switch to week',
              transitionsTo: week,
            },
          ],
        },
        [week]: {
          props: {},
          minSize: { width: 4, height: 4 },
          actions: [
            {
              name: showMonth,
              description: 'Switch to month',
              transitionsTo: month,
            },
          ],
        },
        [day]: {
          props: {},
          minSize: { width: 4, height: 4 },
          actions: [
            {
              name: showMonth,
              description: 'Switch to month',
              transitionsTo: month,
            },
            // Same name as month's showWeek but different target — disambiguator.
            {
              name: showWeek,
              description: 'Restart week elsewhere',
              transitionsTo: month,
            },
          ],
        },
      },
    });

    const inWeekVariant: VesselInstanceSnapshot = {
      instanceId: calendarInstanceId,
      vesselId: calendarVesselId,
      variant: week,
    };

    const plan: RawActionExecution[] = [
      { instanceId: calendarInstanceId, action: showWeek },
    ];

    const { plan: result, skippedActions } = parseExecutionPlan(
      plan,
      [inWeekVariant],
      [ambiguousVessel],
      silentLogger,
    );

    expect(result).toHaveLength(0);
    expect(skippedActions).toHaveLength(1);
    expect(skippedActions[0]).toMatchObject({
      reason: 'action_not_valid',
      action: showWeek,
    });
  });

  test('action exists on another variant but transitionsTo points elsewhere → action_not_valid (regression lock)', () => {
    // Action exists on a sibling variant but its target is not the current
    // sim variant, so the no-op classifier correctly falls through. `day`
    // here intentionally drops `showWeek` from its action list.
    const customVessel = makeVessel({
      id: calendarVesselId,
      name: 'Calendar',
      description: 'Calendar with showWeek removed from day variant',
      defaultVariant: month,
      variants: {
        [month]: {
          description: 'Month view',
          props: {},
          minSize: { width: 4, height: 4 },
          actions: [
            {
              name: showWeek,
              description: 'Switch to week',
              transitionsTo: week,
            },
            { name: showDay, description: 'Switch to day', transitionsTo: day },
          ],
        },
        [week]: {
          description: 'Week view',
          props: {},
          minSize: { width: 4, height: 4 },
          actions: [
            {
              name: showMonth,
              description: 'Switch to month',
              transitionsTo: month,
            },
            { name: showDay, description: 'Switch to day', transitionsTo: day },
          ],
        },
        [day]: {
          description: 'Day view',
          props: {},
          minSize: { width: 4, height: 4 },
          actions: [
            {
              name: showMonth,
              description: 'Switch to month',
              transitionsTo: month,
            },
          ],
        },
      },
    });
    const plan: RawActionExecution[] = [
      { instanceId: calendarInstanceId, action: showWeek },
    ];

    const { plan: result, skippedActions } = parseExecutionPlan(
      plan,
      [inDayVariant],
      [customVessel],
      silentLogger,
    );

    expect(result).toHaveLength(0);
    expect(skippedActions).toHaveLength(1);
    expect(skippedActions[0]).toMatchObject({
      reason: 'action_not_valid',
      action: showWeek,
    });
  });
});
