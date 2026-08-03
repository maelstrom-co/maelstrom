import { type Brand, requireNonEmptyBrand } from './brand.ts';

/**
 * Opaque identifier for an action defined on a vessel variant.
 *
 * Action names are unique within a single variant. The brand captures
 * shape, not cross-variant uniqueness.
 */
export type ActionName = Brand<string, 'ActionName'>;

/**
 * Brands a string as an ActionName without changing its value.
 *
 * Originates from `VesselAction.name` and LLM-output execution-plan items.
 *
 * @example
 * ```ts
 * const action = ActionName('selectOrder');
 * ```
 */
export const ActionName = (value: string): ActionName => {
  requireNonEmptyBrand(value, 'ActionName');
  return value as ActionName;
};
