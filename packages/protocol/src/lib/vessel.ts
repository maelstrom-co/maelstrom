import { z } from 'zod';

import { ActionName } from './action-name.ts';
import { MAX_ACTION_PARAMETER_ENUM_CANDIDATES } from './model-output-limits.ts';
import { ChartSizeSchema } from './schemas.ts';
import { VariantName } from './variant-name.ts';
import { VesselId } from './vessel-id.ts';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * Parses one Action parameter definition, including a bounded enum candidate list.
 * Parameter names are required but remain unbranded author-facing strings.
 */
export const ActionParameterSchema = z.object({
  name: z.string().min(1, 'Parameter name is required'),
  type: z.enum(['string', 'number', 'boolean', 'object']),
  description: z.string().min(1, 'Parameter description is required'),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  enum: z
    .array(z.unknown())
    .max(MAX_ACTION_PARAMETER_ENUM_CANDIDATES)
    .optional(),
});

/**
 * Parses an {@link ActionEffect}: what running an Action does beyond its
 * declared Variant transition.
 */
export const ActionEffectSchema = z.enum(['none', 'idempotent', 'any']);

/**
 * Brands an Action and defers transition-target existence to {@link VesselSchema}.
 *
 * `effect` parses to an explicit {@link ActionEffect}, `'any'` when omitted,
 * so consumers never branch on `undefined`. An Action with effect `'none'`
 * must declare `transitionsTo` and no parameters. See
 * {@link VesselActionDefinition.effect}.
 */
export const VesselActionSchema = z
  .object({
    name: z.string().min(1, 'Action name is required').transform(ActionName),
    description: z.string().min(1, 'Action description is required'),
    parameters: z.array(ActionParameterSchema).optional(),
    transitionsTo: z
      .string()
      .min(1, 'transitionsTo must be non-empty')
      .transform(VariantName)
      .optional(),
    effect: ActionEffectSchema.optional().default('any'),
  })
  .superRefine((action, ctx) => {
    if (action.effect !== 'none') return;
    if (action.transitionsTo === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `Action "${action.name}" declares effect "none" but no transitionsTo`,
        path: ['transitionsTo'],
      });
    }
    if (action.parameters && action.parameters.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Action "${action.name}" declares effect "none" but takes parameters`,
        path: ['parameters'],
      });
    }
  });

/** Validates local Variant shape; cross-Action invariants require {@link VesselSchema}. */
export const VesselVariantSchema = z.object({
  description: z.string().optional(),
  props: z.record(z.string(), z.unknown()),
  minSize: ChartSizeSchema,
  actions: z.array(VesselActionSchema),
});

/**
 * Parses and brands a complete Vessel definition.
 *
 * Requires at least one Variant, a valid default Variant, unique Action and
 * parameter names within their scopes, and valid Action transition targets.
 */
export const VesselSchema = z
  .object({
    id: z.string().min(1, 'Vessel id is required').transform(VesselId),
    name: z.string().min(1, 'Vessel name is required'),
    description: z.string().min(1, 'Vessel description is required'),
    defaultVariant: z
      .string()
      .min(1, 'defaultVariant is required')
      .transform(VariantName),
    variants: z.record(
      z
        .string()
        .min(1, 'Variant name must be non-empty')
        .transform(VariantName),
      VesselVariantSchema,
    ),
  })
  .refine(
    (vessel) => Object.keys(vessel.variants).length > 0,
    'Vessel must have at least one variant',
  )
  .superRefine((vessel, ctx) => {
    // `Object.hasOwn` rather than truthiness on indexed access — a variant
    // name like `'toString'` would resolve to `Object.prototype.toString`
    // (truthy) and silently slip past these existence checks.
    if (
      vessel.defaultVariant &&
      !Object.hasOwn(vessel.variants, vessel.defaultVariant)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Default variant "${vessel.defaultVariant}" does not exist in variants`,
        path: ['defaultVariant'],
      });
    }

    // Catching these at schema time means the engine's runtime simulation can
    // trust that every reachable variant exists and action lookups are
    // unambiguous.
    for (const [variantName, variant] of Object.entries(vessel.variants)) {
      const seenActionNames = new Set<string>();
      for (let i = 0; i < variant.actions.length; i++) {
        const action = variant.actions[i];
        if (!action) continue;

        if (seenActionNames.has(action.name)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate action name "${action.name}" in variant "${variantName}"`,
            path: ['variants', variantName, 'actions', i, 'name'],
          });
        } else {
          seenActionNames.add(action.name);
        }

        const parameters = action.parameters ?? [];
        const seenParameterNames = new Set<string>();
        for (let j = 0; j < parameters.length; j++) {
          const parameter = parameters[j];
          if (!parameter) continue;

          if (seenParameterNames.has(parameter.name)) {
            ctx.addIssue({
              code: 'custom',
              message: `Duplicate parameter name "${parameter.name}" in action "${action.name}"`,
              path: [
                'variants',
                variantName,
                'actions',
                i,
                'parameters',
                j,
                'name',
              ],
            });
          } else {
            seenParameterNames.add(parameter.name);
          }
        }

        if (
          action.transitionsTo &&
          !Object.hasOwn(vessel.variants, action.transitionsTo)
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `Action "${action.name}" in variant "${variantName}" transitions to non-existent variant "${action.transitionsTo}"`,
            path: ['variants', variantName, 'actions', i, 'transitionsTo'],
          });
        }
      }
    }
  });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameter definition for an action */
export type ActionParameter = z.infer<typeof ActionParameterSchema>;

/**
 * What running an Action does beyond its declared Variant transition. See
 * {@link VesselActionDefinition.effect} for the handler rule each value
 * implies.
 *
 * - `'none'`: nothing. The framework only switches the Variant.
 * - `'idempotent'`: an application effect that is safe to run again.
 * - `'any'`: an application effect that may not be safe to run again.
 */
export type ActionEffect = z.infer<typeof ActionEffectSchema>;

/** An action that can be invoked on a Vessel. Post-parse shape with branded fields. See {@link VesselActionDefinition}. */
export type VesselAction = z.infer<typeof VesselActionSchema>;

/** A variant of a Vessel. Post-parse shape with branded fields. See {@link VesselVariantDefinition}. */
export type VesselVariant = z.infer<typeof VesselVariantSchema>;

/**
 * Validated, post-parse Vessel definition: IDs and variant/action names
 * are branded. Use {@link VesselDefinition} for the author-facing
 * unbranded shape accepted by {@link defineVessel}.
 */
export type Vessel = z.infer<typeof VesselSchema>;

/** A single validation issue surfaced by {@link validateVessel}. */
export interface ValidationIssue {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * The result of validating a Vessel object.
 *
 * Discriminated union: constructing `{ valid: true, issues: [...] }` or
 * `{ valid: false, issues: [] }` is a compile error. On success, the parsed
 * `vessel` field carries the branded `Vessel` shape so callers don't have
 * to re-parse to get the post-transform IDs.
 */
export type VesselValidationResult =
  | { readonly valid: true; readonly vessel: Vessel }
  | { readonly valid: false; readonly issues: readonly ValidationIssue[] };

// ---------------------------------------------------------------------------
// Author-facing definition shapes
// ---------------------------------------------------------------------------

/**
 * Author-facing shape for a vessel definition. Distinct from {@link Vessel}
 * (the branded post-validation shape): definitions accept raw string IDs
 * and variant keys; brands appear after `VesselSchema.parse(...)`.
 *
 * Use this as the parameter type when accepting a developer-authored vessel
 * (e.g. `defineVessel`, `registerVessel`). Use {@link Vessel} when working
 * with a vessel that has already crossed the schema boundary.
 */
export interface VesselDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defaultVariant: string;
  readonly variants: Readonly<Record<string, VesselVariantDefinition>>;
}

/** Author-facing shape for a {@link VesselVariant}. See {@link VesselDefinition}. */
export interface VesselVariantDefinition {
  readonly description?: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly minSize: { readonly width: number; readonly height: number };
  readonly actions: ReadonlyArray<VesselActionDefinition>;
}

/** Author-facing shape for a {@link VesselAction}. See {@link VesselDefinition}. */
export interface VesselActionDefinition {
  /** Action name, unique within its Variant. */
  readonly name: string;
  /** What the Action does, written for the Planner that chooses it. */
  readonly description: string;
  /** Parameters the Action's handler receives. Omit for none. */
  readonly parameters?: ReadonlyArray<ActionParameter>;
  /** The Variant the Instance moves to once the Action has run. */
  readonly transitionsTo?: string;
  /**
   * What running this Action does beyond its `transitionsTo`. Defaults to
   * `'any'`.
   *
   * - `'none'`: no application effect. The framework only switches the
   *   Variant, so a handler is optional. Declare it only for a view switch
   *   that needs nothing from the application, such as showing a week view.
   *   It must declare `transitionsTo` and no parameters, and it is safe to
   *   run again.
   * - `'idempotent'`: a handler is required, and running the Action again
   *   with the same parameters leaves the Vessel where one run would, such as
   *   opening an item that may already be open.
   * - `'any'`: a handler is required, and the Action may append, remove or
   *   otherwise accumulate, so it is not safe to run again.
   *
   * An Action without a handler that is not declared `'none'` is skipped and
   * changes no Variant, so a missing handler never reports success. The
   * client's `ActionRunner` type requires those handlers at compile time.
   *
   * The Engine may re-emit an Action on a turn triggered by nothing but a
   * chart resize, and it cannot see Vessel contents to tell a first run from
   * a repeat. Such a turn admits only Actions declared `'none'` or
   * `'idempotent'` that the model invoked with no parameters, since a
   * parameter value there could only have come from an earlier turn.
   */
  readonly effect?: ActionEffect;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Helper to define a vessel while preserving literal types.
 *
 * Constrains to {@link VesselDefinition} (the unbranded author-facing shape)
 * rather than {@link Vessel} so raw string IDs / variant keys / action names
 * are accepted at definition time. Brands are applied later via
 * `VesselSchema.parse(...)` at validation seams.
 *
 * Returns the input shape verbatim (`V`, not widened to `VesselDefinition`)
 * so downstream type-level helpers can extract literal action-name unions
 * for typed action runners.
 */
export function defineVessel<const V extends VesselDefinition>(vessel: V): V {
  return vessel;
}

/** Validate a vessel against the VesselSchema. */
export function validateVessel(vessel: unknown): VesselValidationResult {
  const result = VesselSchema.safeParse(vessel);

  if (result.success) {
    return { valid: true, vessel: result.data };
  }

  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.filter(
        (p): p is string | number => typeof p !== 'symbol',
      ),
      message: issue.message,
    })),
  };
}
