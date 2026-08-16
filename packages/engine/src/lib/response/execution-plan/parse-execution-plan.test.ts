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
  const panelVesselId = VesselId('panel');
  const collapsed = VariantName('collapsed');
  const expanded = VariantName('expanded');
  const goExpanded = ActionName('goExpanded');
  const expandAction = ActionName('expand');
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
  const calendarVesselId = VesselId('calendar');
  const month = VariantName('month');
  const week = VariantName('week');
  const day = VariantName('day');
  const showMonth = ActionName('showMonth');
  const showWeek = ActionName('showWeek');
  const showDay = ActionName('showDay');
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
      { instanceId: calendarInstanceId, action: ActionName('showQuarter') },
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

describe('parseExecutionPlan — action parameter validation', () => {
  const vesselId = VesselId('parameterized');
  const initial = VariantName('initial');
  const transitioned = VariantName('transitioned');
  const configure = ActionName('configure');
  const afterTransition = ActionName('afterTransition');
  const noParams = ActionName('noParams');
  const optionalOnly = ActionName('optionalOnly');
  const objectEnum = ActionName('objectEnum');
  const instanceId = InstanceId('parameterized-1');

  const vessel = makeVessel({
    id: vesselId,
    name: 'Parameterized vessel',
    description: 'Exercises action parameter validation',
    defaultVariant: initial,
    variants: {
      [initial]: {
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          {
            name: configure,
            description: 'Configure and transition',
            transitionsTo: transitioned,
            parameters: [
              { name: 'label', type: 'string', description: 'Label' },
              { name: 'count', type: 'number', description: 'Count' },
              { name: 'enabled', type: 'boolean', description: 'Enabled' },
              { name: 'metadata', type: 'object', description: 'Metadata' },
              {
                name: 'mode',
                type: 'string',
                description: 'Mode',
                enum: ['safe', 'fast'],
              },
            ],
          },
          { name: noParams, description: 'Takes no parameters' },
          {
            name: optionalOnly,
            description: 'All parameters are optional',
            parameters: [
              {
                name: 'note',
                type: 'string',
                description: 'Optional note',
                required: false,
              },
            ],
          },
          {
            name: objectEnum,
            description: 'Uses a non-JSON object enum value',
            parameters: [
              {
                name: 'value',
                type: 'object',
                description: 'Object value',
                enum: [new Date(0)],
              },
            ],
          },
        ],
      },
      [transitioned]: {
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          { name: afterTransition, description: 'Only valid after transition' },
        ],
      },
    },
  });

  const instance: VesselInstanceSnapshot = {
    instanceId,
    vesselId,
    variant: initial,
  };

  const parse = (...items: RawActionExecution[]) =>
    parseExecutionPlan(items, [instance], [vessel], silentLogger);

  test('accepts params matching every supported type and enum', () => {
    const params = {
      label: 'Example',
      count: 2,
      enabled: true,
      metadata: { nested: ['JSON', 1] },
      mode: 'safe',
    };

    expect(
      parse({
        instanceId,
        action: configure,
        paramsJson: JSON.stringify(params),
      }),
    ).toEqual({
      plan: [{ instanceId, action: configure, params }],
      skippedActions: [],
    });
  });

  test('rejects unknown parameter keys without exposing their values', () => {
    const result = parse({
      instanceId,
      action: configure,
      paramsJson: JSON.stringify({
        label: 'Example',
        count: 2,
        enabled: true,
        metadata: {},
        mode: 'safe',
        secret: 'do-not-record',
      }),
    });

    expect(result.plan).toEqual([]);
    expect(result.skippedActions).toEqual([
      {
        reason: 'params_validation_failed',
        instanceId,
        action: configure,
        issues: [{ kind: 'unknown_parameter', parameter: 'secret' }],
      },
    ]);
    expect(JSON.stringify(result.skippedActions)).not.toContain(
      'do-not-record',
    );
  });

  test('treats required as true when omitted and reports every missing parameter', () => {
    const result = parse({ instanceId, action: configure });

    expect(result.plan).toEqual([]);
    expect(result.skippedActions[0]).toEqual({
      reason: 'params_validation_failed',
      instanceId,
      action: configure,
      issues: ['label', 'count', 'enabled', 'metadata', 'mode'].map(
        (parameter) => ({ kind: 'missing_parameter', parameter }),
      ),
    });
  });

  test.each([
    ['label', 1, 'string', 'number'],
    ['count', '2', 'number', 'string'],
    ['enabled', 1, 'boolean', 'number'],
    ['metadata', null, 'object', 'null'],
    ['metadata', [], 'object', 'array'],
  ] as const)('rejects an invalid value for %s', (parameter, value, expected, actual) => {
    const params: Record<string, unknown> = {
      label: 'Example',
      count: 2,
      enabled: true,
      metadata: {},
      mode: 'safe',
      [parameter]: value,
    };
    const result = parse({
      instanceId,
      action: configure,
      paramsJson: JSON.stringify(params),
    });

    expect(result.plan).toEqual([]);
    expect(result.skippedActions[0]).toMatchObject({
      reason: 'params_validation_failed',
      issues: [{ kind: 'type_mismatch', parameter, expected, actual }],
    });
  });

  test('rejects values outside the declared enum', () => {
    const result = parse({
      instanceId,
      action: configure,
      paramsJson: JSON.stringify({
        label: 'Example',
        count: 2,
        enabled: true,
        metadata: {},
        mode: 'unsupported',
      }),
    });

    expect(result.plan).toEqual([]);
    expect(result.skippedActions[0]).toMatchObject({
      reason: 'params_validation_failed',
      issues: [{ kind: 'enum_violation', parameter: 'mode' }],
    });
  });

  test('does not treat non-JSON objects with no keys as an empty object enum match', () => {
    const result = parse({
      instanceId,
      action: objectEnum,
      paramsJson: '{"value":{}}',
    });

    expect(result.plan).toEqual([]);
    expect(result.skippedActions[0]).toMatchObject({
      reason: 'params_validation_failed',
      issues: [{ kind: 'enum_violation', parameter: 'value' }],
    });
  });

  test('accepts an empty object for an action without parameters', () => {
    expect(parse({ instanceId, action: noParams, paramsJson: '{}' })).toEqual({
      plan: [{ instanceId, action: noParams, params: {} }],
      skippedActions: [],
    });
  });

  test('rejects non-empty params for an action without parameters', () => {
    const result = parse({
      instanceId,
      action: noParams,
      paramsJson: '{"unexpected":true}',
    });

    expect(result.plan).toEqual([]);
    expect(result.skippedActions[0]).toMatchObject({
      reason: 'params_validation_failed',
      issues: [{ kind: 'params_not_allowed' }],
    });
  });

  test('accepts omitted params when every declared parameter is optional', () => {
    expect(parse({ instanceId, action: optionalOnly })).toEqual({
      plan: [{ instanceId, action: optionalOnly }],
      skippedActions: [],
    });
  });

  test('an invalid parameterized transition does not advance simulated state', () => {
    const result = parse(
      { instanceId, action: configure, paramsJson: '{}' },
      { instanceId, action: afterTransition },
    );

    expect(result.plan).toEqual([]);
    expect(result.skippedActions.map((skipped) => skipped.reason)).toEqual([
      'params_validation_failed',
      'action_not_valid',
    ]);
  });
});
