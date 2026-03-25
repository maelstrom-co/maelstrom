import type { AnyVesselEntry } from './vessel-entry-types.js';
import type { MaelstromInstance } from './maelstrom-instance-types.js';
import { createMaelstromContext } from './context.js';
import { createProvider } from './provider.js';
import { createUseMaelstrom } from './use-maelstrom.js';

/** Compile-time guard: rejects entries where any vessel ID has widened to `string` */
type AssertNarrowIds<T extends readonly AnyVesselEntry[]> =
  string extends T[number]['vessel']['id']
    ? 'Error: All vessel IDs must be literal string types (e.g. "orders"), not `string`. Use vessel() or defineVessel() to preserve literal types.'
    : T;

export interface CreateMaelstromConfig<T extends readonly AnyVesselEntry[]> {
  vessels: AssertNarrowIds<T> & T;
  cellSizePx?: number;
  debug?: boolean;
}

/** Create a Maelstrom instance with Provider, hooks, and typed vessel access */
export function createMaelstrom<const T extends readonly AnyVesselEntry[]>(
  config: CreateMaelstromConfig<T>,
): MaelstromInstance<T> {
  const contextPair = createMaelstromContext();
  const factoryConfig = {
    cellSizePx: config.cellSizePx,
    debug: config.debug,
  };

  return {
    vessels: config.vessels,
    Provider: createProvider(contextPair, config.vessels, factoryConfig),
    useMaelstrom: createUseMaelstrom(contextPair),
  };
}
