/**
 * Client-specific types for action execution and vessel management.
 *
 * Vessel-shape inference primitives (`ActionNames`, `ActionParams`,
 * `VariantNames`) and the action-runner contract (`ActionRunner`,
 * `ActionHandler`, `ActionResult`) live here. Wire-format types
 * (`ActionExecution`, `VesselDefinition`, `Result`) come from
 * `@maelstrom-co/protocol`.
 */

import type {
  ActionExecution,
  ActionName,
  ActionParameter,
  InstanceId,
  VesselDefinition,
} from '@maelstrom-co/protocol';
import type { TelemetryErrorCategory } from '@maelstrom-co/telemetry';

import type { ActionResult } from './action-result.js';

// ============================================================================
// Type Mapping Utilities
// ============================================================================

type ParamTypeToTS<T extends string> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'object'
        ? Record<string, unknown>
        : unknown;

type GetAllActions<V extends VesselDefinition> =
  V['variants'][keyof V['variants']]['actions'][number];

type ParamForName<
  Params extends ReadonlyArray<ActionParameter>,
  Name extends string,
> = Extract<Params[number], { name: Name }>;

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

type OptionalParamKeys<Params extends ReadonlyArray<ActionParameter>> =
  Params[number] extends infer P
    ? P extends { name: infer N; required: false }
      ? N extends string
        ? N
        : never
      : never
    : never;

type ParamTypeFor<
  Params extends ReadonlyArray<ActionParameter>,
  Name extends string,
> =
  ParamForName<Params, Name> extends { type: infer T }
    ? ParamTypeToTS<T & string>
    : unknown;

type ParamsToObject<Params extends ReadonlyArray<ActionParameter>> = {
  [K in RequiredParamKeys<Params>]: ParamTypeFor<Params, K>;
} & {
  [K in OptionalParamKeys<Params>]?: ParamTypeFor<Params, K>;
};

type GetActionParams<A, Name extends string> = A extends { name: Name }
  ? A extends { parameters: infer P }
    ? P extends ReadonlyArray<ActionParameter>
      ? P['length'] extends 0
        ? undefined
        : ParamsToObject<P>
      : undefined
    : undefined
  : never;

// ============================================================================
// Vessel-Inference Primitives
// ============================================================================

/**
 * Union of action names across all variants of vessel `V`.
 */
export type ActionNames<V extends VesselDefinition> = GetAllActions<V>['name'];

/**
 * Typed parameter object for action `Name` on vessel `V`. Resolves to
 * `undefined` for parameterless actions.
 */
export type ActionParams<
  V extends VesselDefinition,
  Name extends ActionNames<V>,
> = GetActionParams<GetAllActions<V>, Name>;

/**
 * Union of variant keys (variant names) for vessel `V`.
 */
export type VariantNames<V extends VesselDefinition> = keyof V['variants'] &
  string;

// ============================================================================
// Action Handlers
// ============================================================================

/**
 * Handler type for an action. Supports both sync and async handlers.
 * - No params: returns `ActionResult` (or `Promise<ActionResult>`) directly
 * - With params: receives typed params object, returns `Promise<ActionResult>`
 */
export type ActionHandler<Params> = [Params] extends [undefined]
  ? () => Promise<ActionResult> | ActionResult
  : (params: Params) => Promise<ActionResult> | ActionResult;

/**
 * Typed action runner map keyed by action name.
 * All action handlers are optional, but type inference is preserved
 * for any handlers that are implemented.
 *
 * @example
 * ```typescript
 * import { ok } from '@maelstrom-co/protocol';
 *
 * const runner: ActionRunner<typeof myVessel> = {
 *   selectOrder: (params) => {
 *     // params is fully typed based on vessel definition
 *     console.log(params.orderId);
 *     return ok(undefined);
 *   },
 *   closeOrderDetails: () => {
 *     return ok(undefined);
 *   },
 * };
 * ```
 */
export type ActionRunner<V extends VesselDefinition = VesselDefinition> =
  Partial<{
    [Name in ActionNames<V>]: ActionHandler<
      GetActionParams<GetAllActions<V>, Name>
    >;
  }>;

/**
 * Untyped action runner map used for internal storage.
 * This is the runtime representation — type safety is enforced at compile time.
 */
export type AnyActionRunner = Record<
  string,
  (params: unknown) => Promise<ActionResult> | ActionResult
>;

// ============================================================================
// Action Manager Types
// ============================================================================

/**
 * Internal action execution record with resolved runner.
 */
export interface ExecutableAction {
  execution: ActionExecution;
  runner: AnyActionRunner | undefined;
}

/**
 * Action execution summary.
 */
export interface ActionRecord {
  instanceId: InstanceId;
  action: ActionName;
  result: ActionResult;
  duration: number;
  skipped?: boolean;
  /** Producer-known cause of skipped or failed work; omitted when unavailable. */
  errorCategory?: TelemetryErrorCategory;
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
