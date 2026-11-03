import { describe, expect, test } from 'bun:test';

import {
  InstanceId,
  isErr,
  isOk,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { vessels } from './__test-helpers__/fixtures.js';
import { planned } from './__test-helpers__/layout-fixtures.js';
import { declaredVariants } from './declared-variants.js';
import type { PlannedAction } from './types.js';

function instance(instanceId: string, vesselId: string, variant: string) {
  return {
    instanceId: InstanceId(instanceId),
    vesselId: VesselId(vesselId),
    variant: VariantName(variant),
  };
}

function declaredOf(result: ReturnType<typeof declaredVariants>) {
  if (!isOk(result)) throw new Error(`expected ok: ${result.error.kind}`);
  return result.value;
}

describe('declaredVariants', () => {
  test('declares an existing instance in its variant before the actions run', () => {
    const declared = declaredOf(
      declaredVariants(
        [instance('calendar-main', 'calendar', 'month')],
        [planned('calendar-main/showWeek')],
        vessels,
      ),
    );
    expect(declared.variants.get(InstanceId('calendar-main'))).toBe(
      VariantName('month'),
    );
    expect(declared.finalVariants.get(InstanceId('calendar-main'))).toBe(
      VariantName('week'),
    );
  });

  test('declares a new instance in its created variant and keeps its view switch', () => {
    const showWeek = planned('calendar-new/showWeek');
    const declared = declaredOf(
      declaredVariants(
        [instance('calendar-new', 'calendar', 'month')],
        [showWeek],
        vessels,
      ),
    );
    expect(declared.variants.get(InstanceId('calendar-new'))).toBe(
      VariantName('month'),
    );
    expect(declared.finalVariants.get(InstanceId('calendar-new'))).toBe(
      VariantName('week'),
    );
    expect(declared.actions).toEqual([showWeek]);
  });

  test('ships every planned action in order, view switches included', () => {
    const actions = [
      planned('calendar-new/showWeek'),
      planned('calendar-new/showMonth'),
      planned('weather-main/showWeekly'),
      planned('map-new/showRoute', { destination: 'Central Station' }),
    ];
    const declared = declaredOf(
      declaredVariants(
        [
          instance('calendar-new', 'calendar', 'month'),
          instance('weather-main', 'weather', 'current'),
          instance('map-new', 'map', 'overview'),
        ],
        actions,
        vessels,
      ),
    );
    expect(declared.actions).toEqual(actions);
    declared.actions.forEach((action, index) => {
      expect(action).toBe(actions[index] as PlannedAction);
    });
    expect([...declared.variants]).toEqual([
      [InstanceId('calendar-new'), VariantName('month')],
      [InstanceId('weather-main'), VariantName('current')],
      [InstanceId('map-new'), VariantName('overview')],
    ]);
    expect([...declared.finalVariants]).toEqual([
      [InstanceId('calendar-new'), VariantName('month')],
      [InstanceId('weather-main'), VariantName('weekly')],
      [InstanceId('map-new'), VariantName('route')],
    ]);
  });

  test('passes the simulation error through when an action is not offered', () => {
    const result = declaredVariants(
      [instance('weather-main', 'weather', 'current')],
      [planned('weather-main/openEntry')],
      vessels,
    );
    expect(isErr(result) && result.error.kind).toBe('action_not_valid');
  });

  test('passes the simulation error through for an unknown instance', () => {
    const result = declaredVariants(
      [instance('weather-main', 'weather', 'current')],
      [planned('calendar-main/showWeek')],
      vessels,
    );
    expect(isErr(result) && result.error.kind).toBe('unknown_instance');
  });
});
