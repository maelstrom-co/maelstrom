/**
 * Client-specific types for action execution and vessel management.
 *
 * These types provide compile-time type safety for action runners and execution plans,
 * building on top of the wire-format types from @maelstrom-co/protocol-old.
 */

import type {
  ActionExecution,
  ActionParameter,
  Result,
  Vessel,
} from '@maelstrom-co/protocol-old';

// ============================================================================
// Type Mapping Utilities
// ============================================================================

/**
 * Maps action parameter type strings to TypeScript types.
 */
type ParamTypeToTS<T extends string> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'object'
        ? Record<string, unknown>
        : unknown;

/**
 * Flattens all actions across all variants into a single union.
 */
type GetAllActions<V extends Vessel> =
  V['variants'][keyof V['variants']]['actions'][number];

/**
 * Extract a parameter definition by name.
 */
type ParamForName<
  Params extends ReadonlyArray<ActionParameter>,
  Name extends string,
> = Extract<Params[number], { name: Name }>;

/**
 * Keys for required parameters.
 */
type RequiredParamKeys<Params extends ReadonlyArray<ActionParameter>> =
  Params[number] extends infer P
    ? P extends { name: unknown; required: false }
      ? never
      : P extends { name: infer N }
        ? N extends string
          ? N
          : never
        : never
    : never;

/**
 * Keys for optional parameters.
 */
type OptionalParamKeys<Params extends ReadonlyArray<ActionParameter>> =
  Params[number] extends infer P
    ? P extends { name: infer N; required: false }
      ? N extends string
        ? N
        : never
      : never
    : never;

/**
 * Resolves a parameter's TypeScript type by name.
 */
type ParamTypeFor<
  Params extends ReadonlyArray<ActionParameter>,
  Name extends string,
> =
  ParamForName<Params, Name> extends { type: infer T }
    ? ParamTypeToTS<T & string>
    : unknown;

/**
 * Builds a params object type from a parameter definition array.
 */
type ParamsToObject<Params extends ReadonlyArray<ActionParameter>> = {
  [K in RequiredParamKeys<Params>]: ParamTypeFor<Params, K>;
} & {
  [K in OptionalParamKeys<Params>]?: ParamTypeFor<Params, K>;
};

/**
 * Extracts the params object for a given action name.
 */
type GetActionParams<A, ActionName extends string> = A extends {
  name: ActionName;
}
  ? A extends { parameters: infer P }
    ? P extends ReadonlyArray<ActionParameter>
      ? P['length'] extends 0
        ? undefined
        : ParamsToObject<P>
      : undefined
    : undefined
  : never;

// ============================================================================
// Public Type Exports
// ============================================================================

/**
 * Union of all action names across all variants of a vessel.
 */
export type AllVariantActionNames<V extends Vessel> = GetAllActions<V>['name'];

/**
 * Extracts the parameter object for a specific action name.
 */
export type ExtractActionParams<
  V extends Vessel,
  Name extends AllVariantActionNames<V>,
> = GetActionParams<GetAllActions<V>, Name>;

/**
 * Handler type for an action. Supports both sync and async handlers.
 * - No params: returns Result (or Promise<Result>) directly
 * - With params: receives typed params object, returns Promise<Result>
 */
export type ActionHandler<Params> = [Params] extends [undefined]
  ? () => Promise<Result<undefined, Error>> | Result<undefined, Error>
  : (
      params: Params,
    ) => Promise<Result<undefined, Error>> | Result<undefined, Error>;

/**
 * Typed action runner map keyed by action name.
 * All action handlers are optional, but type inference is preserved
 * for any handlers that are implemented.
 *
 * @example
 * ```typescript
 * const runner: ActionRunner<typeof myVessel> = {
 *   selectOrder: (params) => {
 *     // params is fully typed based on vessel definition
 *     console.log(params.orderId);
 *     return Success();
 *   },
 *   closeOrderDetails: () => {
 *     return Success();
 *   },
 * };
 * ```
 */
export type ActionRunner<V extends Vessel = Vessel> = Partial<{
  [Name in AllVariantActionNames<V>]: ActionHandler<
    GetActionParams<GetAllActions<V>, Name>
  >;
}>;

/**
 * Untyped action runner map used for internal storage.
 * This is the runtime representation - type safety is enforced at compile time.
 */
export type AnyActionRunner = Record<
  string,
  (
    params: unknown,
  ) => Promise<Result<undefined, Error>> | Result<undefined, Error>
>;

/**
 * Alias for ActionRunner.
 * @deprecated Use ActionRunner instead
 */
export type ActionHandlersFor<V extends Vessel> = ActionRunner<V>;

/**
 * Alias for all action names on a vessel.
 */
export type ActionNamesFor<V extends Vessel> = AllVariantActionNames<V>;

/**
 * Alias for action param extraction.
 */
export type ActionParamsFor<
  V extends Vessel,
  ActionName extends AllVariantActionNames<V>,
> = ExtractActionParams<V, ActionName>;

// ============================================================================
// Action Manager Types
// ============================================================================

/**
 * Internal action execution record with resolved runner.
 */
export interface ExecutableAction<
  V extends Vessel = Vessel,
  Name extends string = string,
> {
  execution: ActionExecution<V, Name>;
  runner: AnyActionRunner | undefined;
}

/**
 * Action execution summary.
 */
export interface ActionRecord {
  instanceId: string;
  action: string;
  result: Result<undefined, Error>;
  duration: number;
  skipped?: boolean;
}

/**
 * Aggregated results for a batch of action executions.
 */
export interface BatchExecutionResult {
  actions: ActionRecord[];
  allSucceeded: boolean;
  successCount: number;
  failureCount: number;
  skippedCount: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates an execution plan for a specific vessel.
 * This helper function provides type inference for constructing execution plans.
 *
 * @example
 * ```typescript
 * const plan = createExecutionPlan<typeof orderVessel>([
 *   { instanceId: 'orders-1', action: 'selectOrder', params: { orderId: '123' } },
 *   { instanceId: 'orders-1', action: 'closeOrderDetails' },
 * ]);
 * ```
 */
export function createExecutionPlan<V extends Vessel>(
  executions: ActionExecution<V>[],
): ActionExecution<V>[] {
  return executions;
}
