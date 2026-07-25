import { describe, expect, it } from 'vitest';
import { calendarVessel } from './calendar.vessel';

describe('calendarVessel month variant', () => {
  it("gives addEvent/removeEvent/moveEvent a transitionsTo of 'day', so a mutation lands on a variant that actually renders events", () => {
    const month = calendarVessel.variants.month;
    const mutationActions = month.actions.filter((a) =>
      ['addEvent', 'removeEvent', 'moveEvent'].includes(a.name),
    );
    expect(mutationActions).toHaveLength(3);
    for (const action of mutationActions) {
      expect(action.transitionsTo).toBe('day');
    }
  });

  it('leaves week and day variants transitioning to themselves (no forced transition) for event actions', () => {
    for (const variantName of ['week', 'day'] as const) {
      const variant = calendarVessel.variants[variantName];
      const mutationActions = variant.actions.filter((a) =>
        ['addEvent', 'removeEvent', 'moveEvent'].includes(a.name),
      );
      expect(mutationActions).toHaveLength(3);
      for (const action of mutationActions) {
        // `in` rather than a cast: week/day event actions have no
        // transitionsTo in their type at all, so a cast would hide a
        // regression that added one.
        expect(
          'transitionsTo' in action ? action.transitionsTo : undefined,
        ).toBeUndefined();
      }
    }
  });
});
