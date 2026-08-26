import { type Brand, requireNonEmptyBrand } from './brand.ts';
import { isTilingSplitTokenString } from './tiling-split-token.ts';

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
 * Rejects the tiling grammar's reserved namespace — `H`, `V`, and anything
 * prefixed `H:` or `V:` — so the `TilingSplitToken | InstanceId | null`
 * partition holds at runtime and not just on paper. An Instance called
 * `H:hero` would otherwise be branded a split token by the tree schema, read
 * as an arity-two divider, and made to consume the two subtrees that follow.
 *
 * @example
 * ```ts
 * const id = InstanceId('calendar-main');
 * const byId = new Map<InstanceId, Vessel>();
 * ```
 */
export const InstanceId = (value: string): InstanceId => {
  requireNonEmptyBrand(value, 'InstanceId');
  if (isTilingSplitTokenString(value)) {
    throw new Error(
      `InstanceId("${value}") is not allowed. "H", "V", and any "H:"/"V:" prefixed value are reserved for tiling split tokens.`,
    );
  }
  return value as InstanceId;
};
