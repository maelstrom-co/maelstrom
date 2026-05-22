import { type Brand, requireNonEmptyBrand } from './brand.js';

/**
 * Opaque identifier for a vessel definition.
 *
 * Distinct from {@link InstanceId}: a `VesselId` names the *type* of vessel
 * (e.g. `"calendar"`, `"orders"`) — many `InstanceId`s may share one
 * `VesselId`. Always originates from a registered vessel definition.
 */
export type VesselId = Brand<string, 'VesselId'>;

/**
 * Brands a string as a VesselId without changing its value.
 *
 * No auto-gen path — VesselIds always originate from a vessel definition
 * (developer-authored) or from LLM output that references one.
 *
 * @example
 * ```ts
 * const id = VesselId('calendar');
 * const registry = new Map<VesselId, Vessel>();
 * ```
 */
export const VesselId = (value: string): VesselId => {
  requireNonEmptyBrand(value, 'VesselId');
  return value as VesselId;
};
