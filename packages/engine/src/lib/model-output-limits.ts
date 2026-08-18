/** Maximum number of top-level keys accepted in model-authored Action params. */
export const MAX_ACTION_PARAM_KEYS = 64;

/** Maximum accepted depth, with the top-level params object at depth zero. */
export const MAX_ACTION_PARAM_DEPTH = 32;

/** Maximum JSON values inspected for one model-authored params object. */
export const MAX_ACTION_PARAM_TRAVERSAL_UNITS = 4_096;

/** Maximum aggregate enum comparison pairs inspected for one Action. */
export const MAX_ACTION_PARAM_COMPARISON_UNITS = 8_192;

/** Maximum ordinary parameter issues retained for one Action. */
export const MAX_ACTION_PARAM_ISSUES = 16;
