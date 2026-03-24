import type { AnyVesselEntry } from './vessel-entry-types.js';

/** Return type of createMaelstrom — will grow in later slices */
export interface MaelstromInstance<
  T extends readonly AnyVesselEntry[],
> {
  vessels: T;
}
