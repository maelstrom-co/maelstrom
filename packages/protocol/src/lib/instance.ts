import { type Brand, requireNonEmptyBrand } from './brand.ts';

/**
 * Opaque identifier for a vessel instance in a chart.
 * Unique within a chart session; used to correlate layout positions,
 * tiling tree leaves, and execution plan actions with a concrete instance.
 */
export type InstanceId = Brand<string, 'InstanceId'>;

/**
 * Brands a string as an InstanceId without changing its value.
 *
 * Unlike `SessionId` and `MessageId`, this factory has no auto-gen path:
 * an InstanceId always originates from an external source (LLM execution
 * plan, persisted layout, wire frame) where the ID is already chosen.
 * Generating one client-side would mean inventing an identity for an entity
 * Maelstrom didn't create, which is never what callers want.
 *
 * @example
 * ```ts
 * const id = InstanceId('calendar-main');
 * const byId = new Map<InstanceId, Vessel>();
 * ```
 */
export const InstanceId = (value: string): InstanceId => {
  requireNonEmptyBrand(value, 'InstanceId');
  return value as InstanceId;
};
