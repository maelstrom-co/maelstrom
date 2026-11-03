import { describe, expect, test } from 'bun:test';

import { postActionInstances } from './post-action-instances.js';
import { selectScenarios } from './scenarios.js';

const [scenario] = selectScenarios('development', ['quoted-location']);
if (!scenario) throw new Error('fixture scenario is missing');
const { instances, vessels } = scenario.request;

function variantOf(
  shipped: ReturnType<typeof postActionInstances>,
  instanceId: string,
): string | undefined {
  return shipped.find((instance) => instance.instanceId === instanceId)
    ?.variant;
}

describe('postActionInstances', () => {
  test('replays the plan from the declared pre-action variants', () => {
    const shipped = postActionInstances(
      instances,
      [{ instanceId: 'weather-main', action: 'showWeekly' }] as never,
      vessels,
    );
    expect(variantOf(shipped, 'weather-main')).toBe('weekly');
    expect(variantOf(shipped, 'calendar-main')).toBe(
      variantOf(instances, 'calendar-main'),
    );
  });

  test('keeps the declared variants when the plan does not replay', () => {
    const declaredWeekly = instances.map((instance) =>
      instance.instanceId === 'weather-main'
        ? { ...instance, variant: 'weekly' }
        : instance,
    ) as typeof instances;
    const shipped = postActionInstances(
      declaredWeekly,
      [{ instanceId: 'weather-main', action: 'showWeekly' }] as never,
      vessels,
    );
    expect(shipped).toEqual(declaredWeekly);
  });

  test('ignores actions on instances the layout does not declare', () => {
    const shipped = postActionInstances(
      instances,
      [
        { instanceId: 'removed-main', action: 'showWeekly' },
        { instanceId: 'weather-main', action: 'showWeekly' },
      ] as never,
      vessels,
    );
    expect(variantOf(shipped, 'weather-main')).toBe('weekly');
  });
});
