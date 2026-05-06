import { z } from 'zod';

import { ActionName } from './action-name.js';
import { ChartSizeSchema } from './schemas.js';
import { VariantName } from './variant-name.js';
import { VesselId } from './vessel-id.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const ActionParameterSchema = z.object({
  name: z.string().min(1, 'Parameter name is required'),
  type: z.enum(['string', 'number', 'boolean', 'object']),
  description: z.string().min(1, 'Parameter description is required'),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
});

export const VesselActionSchema = z.object({
  name: z.string().min(1, 'Action name is required').transform(ActionName),
  description: z.string().min(1, 'Action description is required'),
  parameters: z.array(ActionParameterSchema).optional(),
  transitionsTo: z.string().min(1).transform(VariantName).optional(),
});

export const VesselVariantSchema = z.object({
  description: z.string().optional(),
  props: z.record(z.string(), z.unknown()),
  minSize: ChartSizeSchema,
  actions: z.array(VesselActionSchema),
});

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
      z.string().min(1).transform(VariantName),
      VesselVariantSchema,
    ),
  })
  .refine(
    (vessel) => Object.keys(vessel.variants).length > 0,
    'Vessel must have at least one variant',
  )
  .superRefine((vessel, ctx) => {
    if (vessel.defaultVariant && !vessel.variants[vessel.defaultVariant]) {
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

        if (action.transitionsTo && !vessel.variants[action.transitionsTo]) {
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

/** Author-facing shape for a {@link VesselVariant}. */
export interface VesselVariantDefinition {
  readonly description?: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly minSize: { readonly width: number; readonly height: number };
  readonly actions: ReadonlyArray<VesselActionDefinition>;
}

/** Author-facing shape for a {@link VesselAction}. */
export interface VesselActionDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters?: ReadonlyArray<ActionParameter>;
  readonly transitionsTo?: string;
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
