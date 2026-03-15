import { z } from 'zod';

import type { Vessel } from './vessel.js';

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

/**
 * Schema for validating action execution objects at runtime for action runners.
 * This validates the structure AFTER paramsJson has been parsed from JSON string to object.
 * For LLM wire format validation, use ActionExecutionSchema from './schemas.js'.
 */
export const RunnerActionExecutionSchema = z.object({
  instanceId: z
    .string()
    .min(1)
    .describe('The ID of the vessel instance to act upon'),
  action: z
    .string()
    .min(1)
    .describe('The action name (must be valid for the current variant)'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Optional parameters for the action. Must be a valid object matching the action's parameter schema.",
    ),
});

/**
 * Inferred TypeScript type from RunnerActionExecutionSchema.
 * This represents an action execution for runners with params as an object (not JSON string).
 */
export type RunnerActionExecution = z.infer<typeof RunnerActionExecutionSchema>;

/**
 * Schema for validating a batch of action executions for runners.
 */
export const RunnerExecutionPlanSchema = z
  .array(RunnerActionExecutionSchema)
  .describe('A sequence of actions to execute in order');

/**
 * Inferred TypeScript type from RunnerExecutionPlanSchema.
 */
export type RunnerExecutionPlan = z.infer<typeof RunnerExecutionPlanSchema>;

/**
 * Schema for action execution results in runners.
 */
export const RunnerActionResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    value: z.unknown().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.instanceof(Error),
  }),
]);

/**
 * Inferred TypeScript type from RunnerActionResultSchema.
 */
export type RunnerActionResult = z.infer<typeof RunnerActionResultSchema>;

/**
 * Validates a runner action execution at runtime.
 * Returns the validated object or throws if invalid.
 */
export function validateRunnerActionExecution(
  value: unknown,
): RunnerActionExecution {
  return RunnerActionExecutionSchema.parse(value);
}

/**
 * Validates a runner execution plan at runtime.
 * Returns the validated array or throws if invalid.
 */
export function validateRunnerExecutionPlan(
  value: unknown,
): RunnerExecutionPlan {
  return RunnerExecutionPlanSchema.parse(value);
}

/**
 * Safe validation that returns a result instead of throwing.
 */
export function safeValidateRunnerActionExecution(
  value: unknown,
):
  | { success: true; data: RunnerActionExecution }
  | { success: false; error: z.ZodError } {
  const result = RunnerActionExecutionSchema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

// ============================================================================
// Type Mapping Utilities for Generic ActionExecution
// ============================================================================

/**
 * Type helper to extract all action names from a vessel.
 * This is used internally by the protocol for type inference.
 */
export type AllVariantActionNames<V extends Vessel> =
  V['variants'][keyof V['variants']]['actions'][number]['name'];

/**
 * Type helper to extract params for a specific action.
 * This is used internally by the protocol for type inference.
 */
export type ExtractActionParams<
  V extends Vessel,
  Name extends AllVariantActionNames<V>,
> = V['variants'][keyof V['variants']]['actions'][number] extends infer A
  ? A extends { name: Name; parameters: infer P }
    ? P extends ReadonlyArray<{ name: string; type: string }>
      ? { [K in P[number]['name']]: unknown }
      : undefined
    : undefined
  : never;

// ============================================================================
// Action Execution Type
// ============================================================================

/**
 * An action execution with typed action names and params.
 *
 * This type provides compile-time type safety when constructing execution plans
 * on the client side. The generic parameters allow for type inference based on
 * vessel definitions.
 *
 * For wire format (server responses), use without generics which defaults to
 * accepting any action name and params as Record<string, unknown>.
 *
 * @example
 * ```typescript
 * // Typed usage (client-side)
 * const execution: ActionExecution<typeof orderVessel> = {
 *   instanceId: 'orders-1',
 *   action: 'selectOrder',  // TypeScript validates this is a valid action
 *   params: { orderId: '123' },  // TypeScript validates params
 * };
 *
 * // Wire format (server response)
 * const execution: ActionExecution = {
 *   instanceId: 'orders-1',
 *   action: 'selectOrder',
 *   params: { orderId: '123' },
 * };
 * ```
 */
export interface ActionExecution<
  V extends Vessel = Vessel,
  Name extends AllVariantActionNames<V> = AllVariantActionNames<V>,
> {
  /** Target Vessel instance */
  instanceId: string;
  /** Action name - constrained to valid actions for this vessel when typed */
  action: Name;
  /** Action parameters - typed based on the action when using generics */
  params?: ExtractActionParams<V, Name>;
}
