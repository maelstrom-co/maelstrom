import type { AnyVesselEntry } from './vessel-entry-types.js';
import type { MaelstromInstance } from './maelstrom-instance-types.js';
import type { MaelstromContextPair } from './context.js';
import type {
  ExtensionOutput,
  MaelstromExtension,
  MaelstromExtensionContext,
} from './extension-types.js';
import { createMaelstromContext } from './context.js';
import { createProvider } from './provider.js';
import { createUseMaelstrom } from './use-maelstrom.js';
import { createChart } from './chart/chart.js';
import { createUseVessel } from './use-vessel.js';
import { createUseActions } from './use-actions.js';
import { createUseInstance } from './use-instance.js';
import { createRegisterVessel } from './register-vessel.js';
import { warnOnce } from './warn-once.js';

/** Compile-time guard: rejects entries where any vessel ID has widened to `string` */
type AssertNarrowIds<T extends readonly AnyVesselEntry[]> =
  string extends T[number]['vessel']['id']
    ? 'Error: All vessel IDs must be literal string types (e.g. "orders"), not `string`. Use vessel() or defineVessel() to preserve literal types.'
    : T;

export interface CreateMaelstromConfig<T extends readonly AnyVesselEntry[]> {
  vessels: AssertNarrowIds<T> & T;
  cellSizePx?: number;
  tilingPaddingPx?: number;
  debug?: boolean;
}

/** Create a Maelstrom instance with Provider, hooks, and typed vessel access */
export function createMaelstrom<const T extends readonly AnyVesselEntry[]>(
  config: CreateMaelstromConfig<T>,
): MaelstromInstance<T> {
  const contextPair = createMaelstromContext();
  const factoryConfig = {
    cellSizePx: config.cellSizePx,
    tilingPaddingPx: config.tilingPaddingPx,
    debug: config.debug,
  };

  const base = {
    vessels: config.vessels,
    Provider: createProvider(contextPair, config.vessels, factoryConfig),
    Chart: createChart(contextPair),
    useMaelstrom: createUseMaelstrom(contextPair),
    useVessel: createUseVessel<T>(contextPair),
    useActions: createUseActions<T>(contextPair),
    useInstance: createUseInstance(contextPair),
    registerVessel: createRegisterVessel(contextPair),
  };

  return makeWithable<T, object>(base, contextPair);
}

function makeWithable<
  T extends readonly AnyVesselEntry[],
  Ext extends ExtensionOutput,
>(
  instance: Omit<MaelstromInstance<T, Ext>, 'with'>,
  contextPair: MaelstromContextPair,
): MaelstromInstance<T, Ext> {
  function withMethod<NewExt extends ExtensionOutput>(
    ext: MaelstromExtension<NewExt>,
  ): MaelstromInstance<T, Ext & NewExt> {
    const additions = ext(contextPair as MaelstromExtensionContext);
    for (const key in additions) {
      if (key in instance) {
        warnOnce(
          `with-collision:${key}`,
          `[maelstrom] Extension overrides existing key '${key}' on the instance — the later extension's value wins.`,
        );
      }
    }
    return makeWithable<T, Ext & NewExt>(
      { ...instance, ...additions } as Omit<MaelstromInstance<T, Ext & NewExt>, 'with'>,
      contextPair,
    );
  }

  return { ...instance, with: withMethod } as MaelstromInstance<T, Ext>;
}
