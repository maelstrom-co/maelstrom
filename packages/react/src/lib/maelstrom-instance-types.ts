import type { ComponentType } from 'react';

import type { AnyVesselEntry } from './vessel-entry-types.js';
import type { MaelstromProviderProps } from './provider.js';
import type { MaelstromState } from './maelstrom-state-types.js';
import type { ChartProps } from './chart/chart.js';

/** Return type of createMaelstrom() */
export interface MaelstromInstance<T extends readonly AnyVesselEntry[]> {
  vessels: T;
  Provider: ComponentType<MaelstromProviderProps>;
  Chart: ComponentType<ChartProps>;
  useMaelstrom: () => MaelstromState;
}
