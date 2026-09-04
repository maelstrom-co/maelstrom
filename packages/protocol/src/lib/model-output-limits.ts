/** Maximum enum candidates accepted for one Action parameter declaration. */
export const MAX_ACTION_PARAMETER_ENUM_CANDIDATES = 64;

/** Maximum UTF-8 size accepted for one model-authored `paramsJson` string. */
export const MAX_ACTION_PARAMS_JSON_UTF8_BYTES = 16_384;

/** Maximum Action entries accepted in one model-authored execution plan. */
export const MAX_EXECUTION_PLAN_ENTRIES = 64;

/**
 * Maximum subtrees one weighted tiling split token may declare.
 *
 * Twelve covers a 2x6 arrangement with headroom and is the real usability
 * bound on a single split; excess weight fields are discarded rather than
 * rescaled.
 */
export const MAX_SPLIT_CHILDREN = 12;

/**
 * Maximum value accepted for a single tiling split weight, in ratio units.
 *
 * Deliberately loose: its job is to bound the arithmetic, not to police
 * proportions. A tight cap would force ratio-rescaling on malformed input,
 * where a loose one means real ratios never reach it and clamping one field
 * in isolation is always adequate.
 */
export const MAX_SPLIT_WEIGHT = 1000;
