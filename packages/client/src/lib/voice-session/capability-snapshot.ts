import type {
  ActionName,
  ActionParameter,
  VariantName,
  Vessel,
  VesselAction,
  VesselId,
} from '@maelstrom-co/protocol';
import { sanitizeControlChars } from '@maelstrom-co/protocol';

/**
 * An array carrying at least one element.
 *
 * Local to this projection rather than shared, because it exists for one
 * reason: here an empty array is a *different* claim than an absent field.
 * `options: []` reads to a voice model as "no valid values exist" and
 * `parameters: []` as "takes an empty argument list" — neither of which the
 * projection ever means, so it drops the field instead. This type is what
 * stops a later edit from quietly emitting the empty version.
 */
type NonEmptyArray<T> = readonly [T, ...T[]];

/**
 * A parameter an action accepts, as the voice model sees it: what to call it,
 * what it means, what kind of value it takes, and — when the vessel declared
 * an enumerated set — which values it will accept.
 *
 * `options` and `optionsOmitted` combine into exactly four states:
 * - neither present — unconstrained: any value of `type` is acceptable.
 * - `options` only — the complete set of values the vessel declared.
 * - both present — a partial set: everything listed is valid, but at least
 *   one declared value had no faithful text form and is missing.
 * - `optionsOmitted` only — values exist but none could be shown: the set
 *   blew the projection budget, or nothing in it could be rendered.
 *
 * In the two omitted states `type` is the only remaining signal about the
 * values that aren't listed, which is why it is always projected.
 */
export interface VesselCapabilityParameter {
  readonly name: string;
  readonly description: string;
  /**
   * The kind of value this parameter takes, carried through unchanged from
   * the vessel definition. Always present, including next to a complete
   * `options` list: for an unconstrained parameter — or one whose options
   * were omitted — it is the only thing telling the model whether to supply
   * a string, a number, a boolean or an object.
   */
  readonly type: ActionParameter['type'];
  /**
   * The values the vessel declared for this parameter, unioned across every
   * variant that declares the action — so this is a *superset*, not a
   * per-variant whitelist: it can list values the variant currently on
   * screen would reject. Read it as "values this parameter can ever take",
   * never as permission to invoke; the vessel stays the authority on what
   * its current variant accepts.
   *
   * Absence means either "any value of `type`" or "declared values that
   * couldn't be listed" — check
   * {@link VesselCapabilityParameter.optionsOmitted} to tell those apart.
   * Never empty: an empty list would read as "no valid values exist".
   */
  readonly options?: NonEmptyArray<string>;
  /**
   * Set when at least one value the vessel declared is missing from
   * `options` — either the whole set exceeded the projection budget (so it
   * was omitted rather than truncated, and `options` is absent) or
   * individual values had no faithful text form and were dropped (so
   * `options` holds the rest). Either way `options`, when present, is a
   * subset rather than the full set.
   *
   * Distinguishes that from "any value of that kind" — without it a
   * parameter whose values couldn't be listed is indistinguishable from an
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
export const MAX_CAPABILITY_OPTION_COUNT = 100;

/**
 * Maximum combined length, in characters, of a parameter's projected enum
 * values (see {@link VesselCapabilityParameter.options}) that may appear in
 * `options`. Applied independently of {@link MAX_CAPABILITY_OPTION_COUNT} — a
 * handful of very long values can blow the context budget well before the
 * count limit is reached.
 */
export const MAX_CAPABILITY_OPTIONS_TOTAL_CHARS = 2000;

/**
 * An action available on a vessel, deduplicated by name across all of its
 * variants — the model needs to know what a vessel can do, not which
 * variant happens to expose the action. Its `parameters` are unioned across
 * those same variants, so an action never appears to take fewer arguments
 * than it can.
 */
export interface VesselCapabilityAction {
  readonly name: ActionName;
  readonly description: string;
  /**
   * Present only when the action declares at least one parameter across its
   * variants. Absent — rather than empty — for an action that takes no
   * arguments, since an empty list would read to the model as "accepts an
   * empty argument list" and invite a call carrying one.
   */
  readonly parameters?: NonEmptyArray<VesselCapabilityParameter>;
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

/**
 * One parameter whose declared enum values are not fully represented in the
 * projected snapshot, identified well enough to fix the vessel definition.
 *
 * The snapshot itself only tells the *model* that something is missing (via
 * {@link VesselCapabilityParameter.optionsOmitted}); this is the developer's
 * side of that signal. Without it an enum that quietly grew past the budget —
 * or that carries values with no text form — is invisible until the model
 * starts guessing values it was never offered.
 */
export interface CapabilityOptionOmission {
  readonly vesselId: VesselId;
  readonly actionName: ActionName;
  readonly parameterName: string;
  /** Values the vessel declared, after merging the enum across variants. */
  readonly declaredCount: number;
  /**
   * How many of those had no faithful text form (a cyclic object,
   * `undefined`, a symbol, a function) and were dropped rather than rendered
   * as a placeholder the model could pick but the vessel could not act on.
   */
  readonly unrenderableCount: number;
  /**
   * Whether the remaining values exceeded
   * {@link MAX_CAPABILITY_OPTION_COUNT} or
   * {@link MAX_CAPABILITY_OPTIONS_TOTAL_CHARS} and so were omitted as a whole
   * list rather than truncated.
   */
  readonly budgetExceeded: boolean;
}

/**
 * What {@link readCapabilitySnapshot} returns: the catalog itself plus the
 * developer-facing record of everything the projection had to leave out.
 *
 * The two travel together because the projection is pure — it reports its
 * own lossiness rather than logging it, leaving the caller to decide how
 * loudly to surface it (`Orchestrator.getCapabilitySnapshot()` warns once,
 * then debugs).
 */
export interface CapabilitySnapshotProjection {
  readonly snapshot: CapabilitySnapshot;
  readonly optionOmissions: readonly CapabilityOptionOmission[];
}

/**
 * Pure projection from the registered vessels to a conversational capability
 * catalog, alongside the record of every declared enum value the projection
 * could not carry into it.
 *
 * Nothing is logged here — the omissions are returned so the projection stays
 * pure and callers choose how to surface them. Most callers want
 * `Orchestrator.getCapabilitySnapshot()`, which unwraps the snapshot and
 * reports the omissions through the orchestrator's logger.
 *
 * @example
 * ```ts
 * const { snapshot, optionOmissions } = readCapabilitySnapshot(vessels);
 * if (optionOmissions.length > 0) {
 *   console.warn('some declared option values never reached the model', optionOmissions);
 * }
 * ```
 */
export function readCapabilitySnapshot(
  vessels: readonly Vessel[],
): CapabilitySnapshotProjection {
  const optionOmissions: CapabilityOptionOmission[] = [];
  const snapshot: CapabilitySnapshot = {
    vessels: vessels.map(({ id, description, variants }) => {
      // A Map preserves insertion order, so accumulating straight into it
      // (rather than a separate Map plus name-order array) keeps first-seen
      // action ordering without a second lookup. The tuple value type carries
      // the invariant that an entry only ever exists because an occurrence
      // was found, so reading the first one below needs no fallback.
      const actionsByName = new Map<
        ActionName,
        [VesselAction, ...VesselAction[]]
      >();
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
            (parameterName, counts) => {
              optionOmissions.push({
                vesselId: id,
                actionName: name,
                parameterName,
                ...counts,
              });
            },
          );
          return {
            name,
            description: sanitizeControlChars(occurrences[0].description),
            ...(parameters !== undefined ? { parameters } : {}),
          };
        },
      );

      return {
        vesselId: id,
        // Every free-form string here reaches the model in one payload, and
        // vessel definitions are routinely rebuilt from runtime data and
        // republished — so descriptions are as untrusted as enum values.
        description: sanitizeControlChars(description),
        variants: Object.entries(variants).map(([name, variant]) => ({
          name: name as VariantName,
          ...(variant.description !== undefined
            ? { description: sanitizeControlChars(variant.description) }
            : {}),
        })),
        actions,
      };
    }),
  };
  return { snapshot, optionOmissions };
}

function isNonEmpty<T>(values: readonly T[]): values is NonEmptyArray<T> {
  return values.length > 0;
}

function hasNonEmptyEnum<T extends { readonly enum?: readonly unknown[] }>(
  parameter: T,
): parameter is T & { readonly enum: NonEmptyArray<unknown> } {
  return parameter.enum !== undefined && isNonEmpty(parameter.enum);
}

// Renders one enum value the way it will actually reach the voice model: a
// string projects as itself (the payload is later `JSON.stringify`d by the
// realtime adapter, which quotes it), while a non-string value — objects and
// arrays are both legal per `ActionParameterSchema`'s `enum: unknown[]` —
// projects as its JSON form. `sanitizeControlChars` strips control characters
// and line-break lookalikes that `JSON.stringify` leaves raw (U+007F, U+0085,
// U+2028, U+2029), which would otherwise let a value read as a fresh line —
// or a fresh instruction — once it reaches the model.
//
// Returns undefined for any value with no faithful text form: a cyclic
// object, `undefined`, a symbol, a function. Falling back to `String(value)`
// there would offer the model "[object Object]" or "undefined" as a value it
// can *choose*, which the vessel never declared and cannot act on. The caller
// drops those and flags the parameter instead — an honest omission, matching
// how the size budget already behaves.
function serializeOptionValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return sanitizeControlChars(value);
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return undefined;
  }
  return json === undefined ? undefined : sanitizeControlChars(json);
}

interface OptionProjection {
  readonly projected: Pick<
    VesselCapabilityParameter,
    'options' | 'optionsOmitted'
  >;
  readonly omitted: OmittedOptionCounts | undefined;
}

type OmittedOptionCounts = Pick<
  CapabilityOptionOmission,
  'declaredCount' | 'unrenderableCount' | 'budgetExceeded'
>;

function projectOptions(values: NonEmptyArray<unknown>): OptionProjection {
  // Deduped on the *serialized* text, not the raw value: sanitization is
  // lossy (every control character becomes a space), so two raw values the
  // cross-variant union rightly kept apart can still land on identical text.
  // Listing it twice offers the model a choice it cannot express. First
  // occurrence wins, so the projected order follows declaration order.
  const serialized: string[] = [];
  const seen = new Set<string>();
  let unrenderableCount = 0;
  for (const value of values) {
    const rendered = serializeOptionValue(value);
    if (rendered === undefined) {
      unrenderableCount += 1;
    } else if (!seen.has(rendered)) {
      seen.add(rendered);
      serialized.push(rendered);
    }
  }

  const totalChars = serialized.reduce((sum, value) => sum + value.length, 0);
  // Per-parameter, not accumulated across parameters/actions/vessels — a
  // running budget would make the outcome depend on iteration order.
  const budgetExceeded =
    serialized.length > MAX_CAPABILITY_OPTION_COUNT ||
    totalChars > MAX_CAPABILITY_OPTIONS_TOTAL_CHARS;
  const omitted =
    budgetExceeded || unrenderableCount > 0
      ? {
          declaredCount: values.length,
          unrenderableCount,
          budgetExceeded,
        }
      : undefined;

  // An empty list takes the omit branch too: callers only project non-empty
  // enums, so nothing left to render means every value was dropped, and
  // `options: []` would read to the model as "no valid values exist".
  if (!isNonEmpty(serialized) || budgetExceeded) {
    return { projected: { optionsOmitted: true }, omitted };
  }
  return {
    projected:
      unrenderableCount > 0
        ? { options: serialized, optionsOmitted: true }
        : { options: serialized },
    omitted,
  };
}

function projectParameters(
  parameters: readonly MergedParameter[],
  reportOmission: (parameterName: string, counts: OmittedOptionCounts) => void,
): NonEmptyArray<VesselCapabilityParameter> | undefined {
  const projected = parameters.map((parameter): VesselCapabilityParameter => {
    const name = parameter.name;
    const type = parameter.type;
    const description = sanitizeControlChars(parameter.description);
    if (!hasNonEmptyEnum(parameter)) return { name, description, type };

    // `enum` is `unknown[]` on the schema; the voice surface is textual.
    const { projected: optionFields, omitted } = projectOptions(parameter.enum);
    if (omitted) reportOmission(name, omitted);
    return { name, description, type, ...optionFields };
  });
  return isNonEmpty(projected) ? projected : undefined;
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
 * deduplicated by rendered identity — the resulting set of options doesn't
 * depend on variant order, though the order values are listed in does (see
 * {@link unionEnumValues}).
 *
 * The unioned enum is therefore a *superset*, not a per-variant whitelist: a
 * value only the route variant declares stays in the list while the overview
 * variant is the one on screen. That's deliberate — the catalog answers "what
 * can this vessel do", not "what is legal this instant" — but it means
 * membership is not permission. Callers must not read
 * {@link VesselCapabilityParameter.options} as per-variant validity; the
 * vessel remains the authority on what its current variant accepts.
 */
function mergeParametersAcrossVariants(
  variantActions: readonly VesselAction[],
): readonly MergedParameter[] {
  const merged = new Map<string, MergedParameter>();
  for (const action of variantActions) {
    for (const parameter of action.parameters ?? []) {
      const existing = merged.get(parameter.name);
      if (!existing) {
        merged.set(parameter.name, toMergedParameter(parameter));
      } else if (hasNonEmptyEnum(parameter)) {
        merged.set(parameter.name, {
          ...toMergedParameter(parameter),
          enum: hasNonEmptyEnum(existing)
            ? unionEnumValues(existing.enum, parameter.enum)
            : parameter.enum,
        });
      }
    }
  }
  return [...merged.values()];
}

// The product of merging one action's parameters across the variants that
// declare it — deliberately not `ActionParameter`. The merge fabricates a
// parameter no single variant declared, and `required` / `defaultValue` have
// no defensible cross-variant answer: whichever variant happened to win would
// be reported as if the vessel had stated it. Dropping them keeps the shape
// down to what the merge can stand behind, and stops the projection reading
// as schema-derived when it isn't.
//
// `type` stays because the projection genuinely needs it — it is the only
// signal a parameter with no listed options gives the voice model. Variants
// that disagree on a parameter's `type` are a definition bug this projection
// can't resolve, so it doesn't try: `name`, `type` and `description` are all
// taken from a single variant (the last to contribute enum values, or the
// first to declare the parameter when none does), so the merged parameter is
// never a mix of fields from different variants. Only `enum` spans them.
interface MergedParameter {
  readonly name: string;
  readonly type: ActionParameter['type'];
  readonly description: string;
  readonly enum?: readonly unknown[];
}

function toMergedParameter(parameter: ActionParameter): MergedParameter {
  return {
    name: parameter.name,
    type: parameter.type,
    description: parameter.description,
    ...(parameter.enum !== undefined ? { enum: parameter.enum } : {}),
  };
}

// Dedupes by a rendered identity rather than the raw value — enum values are
// `unknown[]`, and two occurrences of the same value in different variants
// are one option, not two. The identity has to distinguish everything the
// projection can distinguish: `String(value)` would collapse every object to
// "[object Object]" and drop genuinely different values here, before
// `projectOptions` (and its `optionsOmitted` flag) ever sees them — leaving
// the model a shortened list presented as complete.
function unionEnumValues(
  a: readonly unknown[],
  b: readonly unknown[],
): unknown[] {
  const seen = new Set<string>();
  const union: unknown[] = [];
  for (const value of [...a, ...b]) {
    const key = enumIdentity(value);
    if (!seen.has(key)) {
      seen.add(key);
      union.push(value);
    }
  }
  return union;
}

// Type-tagged so a string never shares a bucket with a value whose JSON form
// happens to match it, and `x:` so cyclic or otherwise unrepresentable values
// don't all collapse into a single bucket.
function enumIdentity(value: unknown): string {
  if (typeof value === 'string') return `s:${value}`;
  try {
    return `j:${JSON.stringify(value)}`;
  } catch {
    return `x:${String(value)}`;
  }
}
