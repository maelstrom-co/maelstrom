import { type Brand, requireNonEmptyBrand } from './brand.js';

/**
 * Opaque identifier for a variant within a vessel definition.
 *
 * Variant names are unique within a single vessel but not globally — two
 * different vessels may both define a `"detail"` variant. The brand
 * captures shape, not cross-vessel uniqueness.
 */
export type VariantName = Brand<string, 'VariantName'>;

/**
 * Brands a string as a VariantName without changing its value.
 *
 * Originates from `Vessel.variants` keys, `VesselAction.transitionsTo`, and
 * LLM output that references a variant.
 */
export const VariantName = (value: string): VariantName => {
  requireNonEmptyBrand(value, 'VariantName');
  return value as VariantName;
};
