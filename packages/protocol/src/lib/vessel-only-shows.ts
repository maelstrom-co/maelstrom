import type { Vessel } from './vessel.ts';

/**
 * Tells whether a Vessel can only change what is shown, never app data.
 *
 * True when no Variant offers an Action, or when every Action in every
 * Variant declares `effect: 'none'`. An `idempotent` or `any` Action counts
 * as able to change data, and so does an Action that omitted `effect`,
 * because the schema parses an omitted effect as `any`.
 *
 * @example
 * ```ts
 * const marker = vesselOnlyShows(vessel) ? 'Shows only.' : 'Can also change data.';
 * ```
 */
export function vesselOnlyShows(vessel: Vessel): boolean {
  return Object.values(vessel.variants).every((variant) =>
    variant.actions.every((action) => action.effect === 'none'),
  );
}
