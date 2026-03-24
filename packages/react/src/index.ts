// Runtime
export { vessel } from './lib/vessel.js';
export { createMaelstrom } from './lib/create-maelstrom.js';

// Types
export type {
  VariantNames,
  VariantPropsUnion,
  ActionNames,
} from '@maelstrom-co/protocol-old';

export type {
  TypedVesselProps,
  VesselEntry,
  LazyVesselEntry,
  LazyVesselComponentLoader,
  VesselIds,
} from './lib/vessel-entry-types.js';

export type { MaelstromInstance } from './lib/maelstrom-instance-types.js';
