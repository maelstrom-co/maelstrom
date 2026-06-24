// Runtime
export { vessel } from './lib/vessel.js';
export { createMaelstrom } from './lib/create-maelstrom.js';

export { defineVessel } from '@maelstrom-co/protocol';
export {
  WebSocketConnector,
  HttpConnector,
} from '@maelstrom-co/client';

// Types — vessel system
export type {
  ActionHandler,
  ActionNames,
  ActionParams,
  ActionResult,
  ActionRunner,
  VariantNames,
} from '@maelstrom-co/client';

export type {
  LazyVesselComponentLoader,
  LazyVesselEntry,
  TypedVesselProps,
  VariantProps,
  VesselEntry,
  VesselIds,
} from './lib/vessel-entry-types.js';

export type { UntypedVesselProps, DynamicVesselHandle } from './lib/dynamic-vessel-types.js';

// Types — factory & instance
export type { MaelstromInstance } from './lib/maelstrom-instance-types.js';
export type { MaelstromState } from './lib/maelstrom-state-types.js';
export type { MaelstromProviderProps } from './lib/provider.js';
export type { CreateMaelstromConfig } from './lib/create-maelstrom.js';
export type { ChartProps } from './lib/chart/chart.js';

// Types — extension API (for extension package authors)
export type {
  MaelstromExtension,
  MaelstromExtensionContext,
  MaelstromExtensionContextValue,
} from './lib/extension-types.js';

// Utilities — reusable by extension packages
export { warnOnce } from './lib/warn-once.js';
