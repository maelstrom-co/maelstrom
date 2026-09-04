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
 * Weights are integers rather than decimals because integers normalized by
 * their sum are exact: `1,1,1` *is* thirds, where `0.33,0.33,0.33` leaves a
 * one-percent gap and reintroduces the inexactness weighted splits exist to
 * remove. Integers also keep the validity predicate total — no NaN, no
 * float-precision edge cases.
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

// Lives in a dependency-free leaf module: the brand factory that mints
// Instance IDs has to consult it, and the layout module that owns the rest
// of the grammar imports that brand. Homing the predicate in either one
// would close a cycle between them.
/**
 * Tests whether `value` matches the split-token grammar — a bare axis or a
 * weighted axis — as opposed to an Instance ID leaf.
 *
 * This is the one definition of what a split token looks like, for code
 * holding a plain string rather than a parsed `TilingNode`. Answering the
 * question in more than one place lets a token be branded an Instance ID in
 * one layer and read as a split in another, which surfaces as the unrelated
 * "leaf not declared in layout.instances".
 */
export function isTilingSplitTokenString(
  value: string,
): value is TilingSplitToken {
  return SPLIT_TOKEN_PREFIX.test(value);
}

/** Claims every axis-prefixed token, well formed or not. */
const SPLIT_TOKEN_PREFIX = /^[HV](:|$)/;
