import type {
  ActionName,
  ActionParameter,
  VariantName,
  Vessel,
  VesselAction,
  VesselId,
} from '@maelstrom-co/protocol';
import { sanitizeLineBreakChars } from '@maelstrom-co/protocol';

/**
 * A parameter an action accepts. `options` is present only when the vessel
 * declared an enumerated set that also fit the projection budget — its
 * absence means either "any value of that kind" or "too many declared
 * values to list"; check {@link VesselCapabilityParameter.optionsOmitted}
 * to tell those two apart.
 */
export interface VesselCapabilityParameter {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly string[];
  /**
   * Set when the vessel declared an enumerated set that exceeded the
   * projection budget, so `options` was omitted rather than truncated.
   * Distinguishes "too many values to list" from "any value of that kind" —
   * without it an overflowing parameter is indistinguishable from an
   * unconstrained one, and the model is told anything goes.
   */
  readonly optionsOmitted?: true;
}

/**
 * Maximum number of enum values a parameter may project into `options`.
 * Bounds how much of a voice model's context budget a single parameter's
 * option list can consume — a parameter whose enum exceeds this count has
 * its options omitted rather than truncated; see
 * {@link VesselCapabilityParameter.optionsOmitted}.
 */
export const MAX_OPTION_COUNT = 100;

/**
 * Maximum combined length, in characters, of a parameter's projected enum
 * values (see {@link VesselCapabilityParameter.options}) that may appear in
 * `options`. Applied independently of {@link MAX_OPTION_COUNT} — a handful
 * of very long values can blow the context budget well before the count
 * limit is reached.
 */
export const MAX_OPTIONS_TOTAL_CHARS = 2000;

/**
 * An action available on a vessel, deduplicated by name across all of its
 * variants — the model needs to know what a vessel can do, not which
 * variant happens to expose the action.
 */
export interface VesselCapabilityAction {
  readonly name: ActionName;
  readonly description: string;
  readonly parameters?: readonly VesselCapabilityParameter[];
}

/** A variant a vessel can be shown in. */
export interface VesselCapabilityVariant {
  readonly name: VariantName;
  readonly description?: string;
}

/**
 * Conversational catalog entry for one registered vessel: its purpose, the
 * variants it can be shown in, and the actions that can transform it.
 * Deliberately excludes size constraints and props — this answers "what can
 * be shown and which values an action accepts", not "how to plan a layout".
 */
export interface VesselCapability {
  readonly vesselId: VesselId;
  readonly description: string;
  readonly variants: readonly VesselCapabilityVariant[];
  readonly actions: readonly VesselCapabilityAction[];
}

/**
 * The full capability catalog: every registered vessel's purpose, variants,
 * and actions. Source of truth for the `get_capabilities` voice tool —
 * answers "what can you show me?" the way {@link UIStructuralSnapshot}
 * answers "what's on screen right now?".
 */
export interface CapabilitySnapshot {
  readonly vessels: readonly VesselCapability[];
}

function hasNonEmptyEnum(
  parameter: ActionParameter,
): parameter is ActionParameter & { enum: readonly unknown[] } {
  return Boolean(parameter.enum && parameter.enum.length > 0);
}

// Renders one enum value the way it will actually reach the voice model: a
// string projects as itself (the payload is later `JSON.stringify`d by the
// realtime adapter, which quotes it), while a non-string value — objects and
// arrays are both legal per `ActionParameterSchema`'s `enum: unknown[]` —
// projects as its JSON form instead of `String(value)`, which would collapse
// every object to the indistinguishable literal "[object Object]" and every
// array to a comma-joined string. `sanitizeLineBreakChars` strips control
// characters and line-break lookalikes that `JSON.stringify` leaves raw
// (U+007F, U+0085, U+2028, U+2029), which would otherwise let a value read
// as a fresh line — or a fresh instruction — once it reaches the model.
function serializeOptionValue(value: unknown): string {
  if (typeof value === 'string') {
    return sanitizeLineBreakChars(value);
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  return sanitizeLineBreakChars(json ?? String(value));
}

function projectOptions(
  values: readonly unknown[],
): { options: readonly string[] } | { optionsOmitted: true } {
  const serialized = values.map(serializeOptionValue);
  const totalChars = serialized.reduce((sum, value) => sum + value.length, 0);
  // Per-parameter, not accumulated across parameters/actions/vessels — a
  // running budget would make the outcome depend on iteration order.
  if (
    serialized.length > MAX_OPTION_COUNT ||
    totalChars > MAX_OPTIONS_TOTAL_CHARS
  ) {
    return { optionsOmitted: true };
  }
  return { options: serialized };
}

function projectParameters(
  parameters: readonly ActionParameter[],
): readonly VesselCapabilityParameter[] | undefined {
  if (parameters.length === 0) return undefined;
  return parameters.map((parameter) => ({
    name: parameter.name,
    description: parameter.description,
    // `enum` is `unknown[]` on the schema; the voice surface is textual.
    ...(hasNonEmptyEnum(parameter) ? projectOptions(parameter.enum) : {}),
  }));
}

/**
 * Merges one action's parameters across every variant that declares it.
 * `VesselActionSchema` doesn't require identical parameters in every
 * variant an action appears in (e.g. `showRoute` might gain `avoidTolls`
 * only once a variant has room for it), and a parameter's `enum` can be
 * added or widened on some variants without every variant being kept in
 * sync — so picking whichever variant `Object.values` yields first would
 * arbitrarily hide parameters or drop back to the unconstrained version
 * depending on object key order. Union by parameter name; when more than
 * one variant declares a non-empty `enum` for the same parameter, their
 * values are unioned into a single set rather than one being discarded,
 * deduplicated by stringified value — the resulting set of options doesn't
 * depend on variant order, though the order values are listed in does (see
 * {@link unionEnumValues}).
 */
function mergeParametersAcrossVariants(
  variantActions: readonly VesselAction[],
): readonly ActionParameter[] {
  const merged = new Map<string, ActionParameter>();
  for (const action of variantActions) {
    for (const parameter of action.parameters ?? []) {
      const existing = merged.get(parameter.name);
      if (!existing) {
        merged.set(parameter.name, parameter);
      } else if (hasNonEmptyEnum(parameter)) {
        merged.set(
          parameter.name,
          hasNonEmptyEnum(existing)
            ? {
                ...parameter,
                enum: unionEnumValues(existing.enum, parameter.enum),
              }
            : parameter,
        );
      }
    }
  }
  return [...merged.values()];
}

// Dedupes by String(value) rather than the raw value — enum values are
// `unknown[]`, and voice options are stringified downstream anyway, so two
// values that render identically (e.g. equal strings from different
// variants) should count as the same option instead of appearing twice.
function unionEnumValues(
  a: readonly unknown[],
  b: readonly unknown[],
): unknown[] {
  const seen = new Set<string>();
  const union: unknown[] = [];
  for (const value of [...a, ...b]) {
    const key = String(value);
    if (!seen.has(key)) {
      seen.add(key);
      union.push(value);
    }
  }
  return union;
}

/** Pure projection from the registered vessels to a conversational capability catalog. */
export function readCapabilitySnapshot(
  vessels: readonly Vessel[],
): CapabilitySnapshot {
  return {
    vessels: vessels.map(({ id, description, variants }) => {
      // A Map preserves insertion order, so accumulating straight into it
      // (rather than a separate Map plus name-order array) keeps first-seen
      // action ordering without a second lookup.
      const actionsByName = new Map<ActionName, VesselAction[]>();
      for (const variant of Object.values(variants)) {
        for (const action of variant.actions) {
          const occurrences = actionsByName.get(action.name);
          if (occurrences) {
            occurrences.push(action);
          } else {
            actionsByName.set(action.name, [action]);
          }
        }
      }

      const actions = [...actionsByName.entries()].map(
        ([name, occurrences]): VesselCapabilityAction => {
          const parameters = projectParameters(
            mergeParametersAcrossVariants(occurrences),
          );
          return {
            name,
            // biome-ignore lint/style/noNonNullAssertion: occurrences is only ever set() with a non-empty array.
            description: occurrences[0]!.description,
            ...(parameters !== undefined ? { parameters } : {}),
          };
        },
      );

      return {
        vesselId: id,
        description,
        variants: Object.entries(variants).map(([name, variant]) => ({
          name: name as VariantName,
          ...(variant.description !== undefined
            ? { description: variant.description }
            : {}),
        })),
        actions,
      };
    }),
  };
}
