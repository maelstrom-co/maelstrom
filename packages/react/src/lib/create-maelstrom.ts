import type { AnyVesselEntry } from './vessel-entry-types.js';
import type { MaelstromInstance } from './maelstrom-instance-types.js';

/** Compile-time guard: rejects entries where any vessel ID has widened to `string` */
type AssertNarrowIds<T extends readonly AnyVesselEntry[]> =
  string extends T[number]['vessel']['id']
    ? 'Error: All vessel IDs must be literal string types (e.g. "orders"), not `string`. Use vessel() or defineVessel() to preserve literal types.'
    : T;

/** Create a Maelstrom instance from a set of vessel entries */
export function createMaelstrom<const T extends readonly AnyVesselEntry[]>(
  config: { vessels: AssertNarrowIds<T> & T },
): MaelstromInstance<T> {
  return { vessels: config.vessels };
}
