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

// oxlint-disable-next-line typescript/ban-types -- The empty intersection flattens the mapped type in editor hovers and error output.
type Simplify<T> = { [K in keyof T]: T[K] } & {};

type HandlerRequiredActionNames<V extends VesselDefinition> = Exclude<
  GetAllActions<V>,
  { readonly effect: 'none' }
>['name'];

type HandlerOptionalActionNames<V extends VesselDefinition> = Exclude<
  ActionNames<V>,
  HandlerRequiredActionNames<V>
>;

type ActionHandlerFor<
  V extends VesselDefinition,
  Name extends string,
> = ActionHandler<GetActionParams<GetAllActions<V>, Name>>;

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
 * Typed action runner map keyed by action name, inferred from the Vessel
 * definition.
 *
 * A handler is required for every Action that is not declared
 * `effect: 'none'`, because such an Action without a handler is skipped and
 * changes no Variant. A handler is optional for an Action declared
 * `effect: 'none'`: the framework applies its transition on its own. When the
 * same Action name appears on several Variants, its handler is required if any
 * of those declarations is not `'none'`.
 *
 * A widened definition typed as plain `VesselDefinition`, whose Action names
 * are not literal, makes every handler optional.
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
 *   // `showList` is declared `effect: 'none'`, so it may be left out.
 * };
 * ```
 */
export type ActionRunner<V extends VesselDefinition = VesselDefinition> =
  string extends ActionNames<V>
    ? { [Name in ActionNames<V>]?: ActionHandlerFor<V, Name> }
    : Simplify<
        {
          [Name in HandlerRequiredActionNames<V>]: ActionHandlerFor<V, Name>;
        } & {
          [Name in HandlerOptionalActionNames<V>]?: ActionHandlerFor<V, Name>;
        }
      >;

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
  /**
   * Human-readable diagnostic for why a skipped Action did not run, naming the
   * Action, the Instance and, when known, its Variant. Set on skips recorded
   * while Actions resolve against their Instance's Variant: `application`
   * skips, and `readiness` skips for a runner that went away mid-sequence.
   * The readiness skip before any Action runs, and execution without Variant
   * resolution, leave it unset. Branch on `errorCategory`, not on this text.
   */
  reason?: string;
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
