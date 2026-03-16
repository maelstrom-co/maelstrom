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
/** The result of validating a Vessel object. */
export interface VesselValidationResult {
  valid: boolean;
  issues: Array<{
    code: string;
    path: (string | number | symbol)[];
    message: string;
  }>;
}

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
    return { valid: true, issues: [] };
  }

  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path,
      message: issue.message,
    })),
  };
}
