import { describe, expect, test } from 'bun:test';

import {
  ActionName,
  InstanceId,
  isErr,
  isOk,
  VariantName,
  type Vessel,
  VesselId,
} from '@maelstrom-co/protocol';

import { vessels } from './__test-helpers__/fixtures.js';
import { finalVariants, legalActions } from './final-variants.js';

const weather = {
  instanceId: InstanceId('weather-main'),
  vesselId: VesselId('weather'),
  variant: VariantName('current'),
};
const step = (action: string, instanceId = 'weather-main') => ({
  instanceId: InstanceId(instanceId),
  action: ActionName(action),
});

describe('finalVariants (mirrors the engine simulate-variant rule)', () => {
  test('an action without transitionsTo keeps the variant (engine: "advanced" without a set)', () => {
    const result = finalVariants([weather], [step('setLocation')], vessels);
    expect(isOk(result) && String(result.value.get(weather.instanceId))).toBe(
      'current',
    );
  });

  test('sequential transitions take the last target (engine: sim.variants.set per action, in order)', () => {
    const result = finalVariants(
      [weather],
      [step('showWeekly'), step('setLocation'), step('showCurrent')],
      vessels,
    );
    expect(isOk(result) && String(result.value.get(weather.instanceId))).toBe(
      'current',
    );
  });

  test('a later action resolves against the simulated variant (engine: resolveAction reads sim.variants)', () => {
    const result = finalVariants([weather], [step('showCurrent')], vessels);
    expect(isErr(result) && result.error.kind).toBe('action_not_valid');
  });

  test('instances without actions keep their variant', () => {
    const tasks = {
      instanceId: InstanceId('tasks-main'),
      vesselId: VesselId('tasks'),
      variant: VariantName('list'),
    };
    const result = finalVariants(
      [weather, tasks],
      [step('showWeekly')],
      vessels,
    );
    expect(isOk(result) && String(result.value.get(tasks.instanceId))).toBe(
      'list',
    );
    expect(isOk(result) && String(result.value.get(weather.instanceId))).toBe(
      'weekly',
    );
  });

  test('an unknown transition target is flagged (engine: "drift", action dropped)', () => {
    const drifted = vessels.map((vessel) =>
      vessel.id === 'weather'
        ? ({
            ...vessel,
            variants: {
              current: {
                ...vessel.variants[VariantName('current')],
                actions: [
                  {
                    name: ActionName('showRadar'),
                    description: 'Radar',
                    transitionsTo: VariantName('radar'),
                    idempotent: true,
                  },
                ],
              },
            },
          } as Vessel)
        : vessel,
    );
    const result = finalVariants([weather], [step('showRadar')], drifted);
    expect(isErr(result) && result.error.kind).toBe('unknown_target');
  });

  test('an unknown instance is flagged', () => {
    const result = finalVariants(
      [weather],
      [step('setLocation', 'nope')],
      vessels,
    );
    expect(isErr(result) && result.error.kind).toBe('unknown_instance');
  });
});

test('legalActions lists the actions of the given variant', () => {
  expect(
    legalActions(VesselId('weather'), VariantName('weekly'), vessels).map(
      (action) => String(action.name),
    ),
  ).toEqual(['setLocation', 'showCurrent']);
  expect(
    legalActions(VesselId('weather'), VariantName('radar'), vessels),
  ).toEqual([]);
});
