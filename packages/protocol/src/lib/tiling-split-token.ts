/** Split axis in the tiling tree: `H` (horizontal) or `V` (vertical). */
export type TilingSplit = 'H' | 'V';

/**
 * A split token carrying an explicit weight suffix: an axis, a colon, then
 * comma-separated positive integers — `"V:1,1,1"`, `"H:2,1"`.
 *
 * The weight count **declares the token's arity**. `"V:1,1,1"` consumes the
 * next three subtrees from the preorder array, not two, and each child takes
 * `weight / sum(weights)` of the parent region.
 *
 * A weight is a share relative to its siblings, not a fraction of the parent,
 * so any uniform scaling is a no-op: `1,1,1` and `2,2,2` are both exact
 * thirds. Weights are integers because integers keep the validity predicate
 * total — no NaN, no float-precision edge cases — and because a decimal field
 * is not interpreted: {@link parseTilingSplitToken} rounds it to the nearest
 * integer with a floor of 1, so `"V:0.7,0.3"` reads as an even two-way split
 * and reports itself repaired.
 *
 * The template literal admits any suffix, including malformed ones, so that a
 * prefixed token is never mistaken for an Instance ID leaf.
 * {@link parseTilingSplitToken} is where a suffix is interpreted.
 */
export type TilingWeightedSplit = `${TilingSplit}:${string}`;

/**
 * Any token that divides its region: a bare axis or a weighted axis.
 *
 * Bare `'H'` / `'V'` mean exactly `weights: [1, 1]` and stay the preferred
 * spelling for an even two-way split.
 */
export type TilingSplitToken = TilingSplit | TilingWeightedSplit;

/**
 * Tests whether `value` matches the split-token grammar — a bare axis or a
 * weighted axis — as opposed to an Instance ID leaf.
 *
 * This is the one definition of what a split token looks like, for code
 * holding a plain string rather than a parsed `TilingNode`.
 */
export function isTilingSplitTokenString(
  value: string,
): value is TilingSplitToken {
  return SPLIT_TOKEN_PREFIX.test(value);
}

/** Claims every axis-prefixed token, well formed or not. */
const SPLIT_TOKEN_PREFIX = /^[HV](:|$)/;
