import { z } from 'zod';

import { ChartSizeSchema } from './schemas.js';

// ============================================================================
// Vessel Schemas
// ============================================================================

export const ActionParameterSchema = z.object({
  name: z.string().min(1, 'Parameter name is required'),
  type: z.enum(['string', 'number', 'boolean', 'object']),
  description: z.string().min(1, 'Parameter description is required'),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
});

export const VesselActionSchema = z.object({
  name: z.string().min(1, 'Action name is required'),
  description: z.string().min(1, 'Action description is required'),
  parameters: z.array(ActionParameterSchema).optional(),
  transitionsTo: z.string().optional(),
});

export const VesselVariantSchema = z.object({
  description: z.string().optional(),
  props: z.record(z.string(), z.unknown()),
  minSize: ChartSizeSchema,
  actions: z.array(VesselActionSchema),
});

export const VesselSchema = z
  .object({
    id: z.string().min(1, 'Vessel id is required'),
    name: z.string().min(1, 'Vessel name is required'),
    description: z.string().min(1, 'Vessel description is required'),
    defaultVariant: z.string().min(1, 'defaultVariant is required'),
    variants: z.record(z.string(), VesselVariantSchema),
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

    // Validate each variant's actions: unique names + transitionsTo graph integrity.
    // Catching these at schema time means the engine's runtime simulation can trust
    // that every reachable variant exists and that action lookups are unambiguous.
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

// ============================================================================
// Type Exports
// ============================================================================

/** Parameter definition for an action */
export type ActionParameter = z.infer<typeof ActionParameterSchema>;
/** An action that can be invoked on a Vessel */
export type VesselAction = z.infer<typeof VesselActionSchema>;
/** A variant represents a distinct state of the Vessel */
export type VesselVariant = z.infer<typeof VesselVariantSchema>;
/** Definition of a Vessel as a state machine */
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
 * Discriminated union: the `issues` array is only present (and non-empty by
 * convention) when `valid` is `false`. The success variant carries no
 * payload, so constructing `{ valid: true, issues: [...] }` or
 * `{ valid: false, issues: [] }` is a compile error.
 */
export type VesselValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly issues: readonly ValidationIssue[] };

/**
 * Helper to define a vessel while preserving literal types.
 *
 * Use this helper to keep action names and parameter names literal for
 * type inference in ActionRunner.
 */
export function defineVessel<const V extends Vessel>(vessel: V): V {
  return vessel;
}

/**
 * Validate a vessel against the VesselSchema.
 *
 * @param vessel - The vessel data to validate
 * @returns A validation result with valid flag and any issues found
 */
export function validateVessel(vessel: unknown): VesselValidationResult {
  const result = VesselSchema.safeParse(vessel);

  if (result.success) {
    return { valid: true };
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
