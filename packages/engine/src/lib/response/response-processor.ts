import type {
  ActionExecution,
  GridLayout,
  GridPosition,
  MaelstromResponse,
  Result,
  TilingInstance,
  TilingLayout,
  TilingNode,
} from '@maelstrom-co/protocol';
import { err, InstanceId, isErr, ok } from '@maelstrom-co/protocol';
import type {
  ChartRequest,
  GridResponse,
  Vessel,
  VesselAction,
  VesselInstanceSnapshot,
  VesselVariant,
} from '@maelstrom-co/protocol-old';

import type { EngineError } from '../errors.js';
import { parseError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LLMOutput } from '../pipeline/call-llm.js';

type RawActionExecution = GridResponse['executionPlan'][number];

/**
 * Reason a raw action was dropped during execution plan parsing. Kinds mirror
 * {@link ResolveFailure} plus `params_parse_failed` for the JSON parse stage
 * and `state_drift` for actions that resolve cleanly but whose `transitionsTo`
 * target has gone missing from a registered vessel since registration time.
 */
export type SkippedActionReason =
  | 'unknown_instance'
  | 'unknown_vessel'
  | 'no_simulated_variant'
  | 'variant_not_on_vessel'
  | 'action_not_valid'
  | 'params_parse_failed'
  | 'state_drift';

/**
 * Structured record of a single action dropped during validation. Consumed
 * by the retry pipeline (MAE-125) to decide whether to re-prompt the LLM.
 */
export interface SkippedAction {
  readonly instanceId: string;
  readonly action: string;
  readonly reason: SkippedActionReason;
  readonly detail?: string;
}

/**
 * Engine-internal diagnostics surfaced alongside a successful response.
 * Never crosses the engine boundary — {@link InternalResponse} is stripped
 * in `engine.process()` before returning to the caller.
 */
export interface EngineDiagnostics {
  readonly skippedActions: readonly SkippedAction[];
}

/**
 * Internal to the engine package. Extends {@link MaelstromResponse} with
 * engine-local diagnostics so the pipeline can observe validation drops
 * without leaking them to the client.
 */
export type InternalResponse = MaelstromResponse & {
  readonly diagnostics: EngineDiagnostics;
};

/**
 * Processes LLM output into an {@link InternalResponse}.
 *
 * @remarks
 * Execution plan parsing includes variant state simulation: as actions are
 * processed sequentially, the simulated variant state is updated to track
 * transitions (actions with `transitionsTo`). This allows validation of each
 * action against the current simulated variant, not just the initial state.
 *
 * Invalid actions are skipped with warnings rather than failing the entire
 * request, following a graceful degradation approach. Every skipped action is
 * also recorded in {@link EngineDiagnostics.skippedActions} so the retry loop
 * can inspect structured reasons without scraping log messages.
 */
export function processResponse(
  llmOutput: LLMOutput,
  request: ChartRequest,
  logger: Logger,
): Result<InternalResponse, EngineError> {
  if (!llmOutput.userMessage?.trim()) {
    return err(
      parseError('LLM response missing userMessage', JSON.stringify(llmOutput)),
    );
  }

  const layout = buildLayout(llmOutput.layout, request.context.layoutMode);
  const { plan: executionPlan, skippedActions } = parseExecutionPlan(
    llmOutput.executionPlan,
    request.instances,
    request.vessels,
    logger,
  );

  return ok({
    type: 'maelstrom_response',
    requestId: request.id,
    userMessage: llmOutput.userMessage,
    rationale: llmOutput.rationale,
    executionPlan,
    layout,
    diagnostics: { skippedActions },
  });
}

// ---------------------------------------------------------------------------
// Layout construction
// ---------------------------------------------------------------------------

/**
 * Reconstructs the layout discriminant based on layoutMode.
 *
 * The LLM output schemas intentionally omit the `type` discriminant to reduce
 * token usage and simplify the LLM's output format. We reconstruct it here
 * based on the layoutMode from the request, which is guaranteed to match the
 * schema used for the LLM call (both are selected by request.context.layoutMode).
 *
 * This is safe because:
 * 1. The LLM was constrained to output the schema matching layoutMode
 * 2. Zod validation already passed, confirming the structure matches
 * 3. Exhaustive switch ensures all cases are handled at compile time
 */
function buildLayout(
  llmLayout: LLMOutput['layout'],
  mode: 'grid' | 'tiling',
): GridLayout | TilingLayout {
  switch (mode) {
    case 'grid': {
      const gl = llmLayout as {
        positions: ReadonlyArray<
          Omit<GridPosition, 'instanceId'> & { instanceId: string }
        >;
      };
      const positions: readonly GridPosition[] = gl.positions.map((p) => ({
        ...p,
        instanceId: InstanceId(p.instanceId),
      }));
      return { type: 'grid', positions };
    }
    case 'tiling': {
      const tl = llmLayout as {
        tree: ReadonlyArray<string | null>;
        instances: ReadonlyArray<
          Omit<TilingInstance, 'instanceId'> & { instanceId: string }
        >;
      };
      const tree: readonly TilingNode[] = tl.tree.map(brandTilingNode);
      const instances: readonly TilingInstance[] = tl.instances.map((i) => ({
        ...i,
        instanceId: InstanceId(i.instanceId),
      }));
      return { type: 'tiling', tree, instances };
    }
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unsupported layout mode: ${_exhaustive}`);
    }
  }
}

function brandTilingNode(node: string | null): TilingNode {
  if (node === null || node === 'H' || node === 'V') return node;
  return InstanceId(node);
}

// ---------------------------------------------------------------------------
// Execution plan parsing (paramsJson → params)
// ---------------------------------------------------------------------------

function parseParams(
  paramsJson: string,
  action: string,
  instanceId: string,
  logger: Logger,
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch (parseErr) {
    logger.error(
      `Failed to parse paramsJson for action "${action}" on "${instanceId}", skipping action`,
      parseErr,
      { paramsJson },
    );
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const parsedType = Array.isArray(parsed)
      ? 'array'
      : parsed === null
        ? 'null'
        : typeof parsed;
    logger.error(
      `paramsJson for action "${action}" on "${instanceId}" is not a JSON object, skipping action`,
      undefined,
      { paramsJson, parsedType },
    );
    return undefined;
  }

  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Execution plan parsing: immutable lookups + mutable simulation state
// ---------------------------------------------------------------------------

/**
 * Immutable lookups and infrastructure for parsing a single execution plan.
 * Everything in here is fixed for the duration of the parse.
 */
interface ValidationLookups {
  readonly instanceMap: ReadonlyMap<string, VesselInstanceSnapshot>;
  readonly vesselMap: ReadonlyMap<string, Vessel>;
  readonly logger: Logger;
}

/**
 * Mutable per-instance variant state as the plan is walked. Split from
 * {@link ValidationLookups} so the two value categories — frozen inputs
 * vs. accumulating state — have distinct types at the call sites.
 *
 * Note on `readonly`: the `variants` field prevents reassignment of the
 * Map reference, but callers can still mutate the Map contents via
 * `.set()` / `.delete()`. The "simulation mutates" discipline is enforced
 * by convention — only {@link updateSimulatedVariant} writes to
 * `sim.variants`, and it is the only site in the module with write access.
 */
interface SimulationState {
  readonly variants: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Action resolution
// ---------------------------------------------------------------------------

/**
 * A fully resolved action: every lookup has succeeded and the action is
 * valid in the current simulated variant state. Once we hold a ResolvedAction,
 * the action is guaranteed executable from the engine's point of view.
 */
interface ResolvedAction {
  readonly instance: VesselInstanceSnapshot;
  readonly vessel: Vessel;
  readonly currentVariant: string;
  readonly variantDef: VesselVariant;
  readonly actionDef: VesselAction;
}

/**
 * Why {@link resolveAction} rejected a raw action. Structured so callers
 * can build validation telemetry without re-parsing warning strings.
 */
type ResolveFailure =
  | { readonly kind: 'unknown_instance' }
  | { readonly kind: 'unknown_vessel'; readonly vesselId: string }
  | { readonly kind: 'no_simulated_variant' }
  | {
      readonly kind: 'variant_not_on_vessel';
      readonly vesselId: string;
      readonly variant: string;
    }
  | {
      readonly kind: 'action_not_valid';
      readonly vesselId: string;
      readonly variant: string;
      readonly validActions: readonly string[];
    };

/**
 * Resolves a raw action against the current simulation state in a single
 * pass: instance → vessel → simulated variant → variant definition → action.
 *
 * Pure — returns a {@link Result} with no side effects. The failure variant
 * names the specific reason so the caller can both log and build structured
 * telemetry from one source of truth; see {@link logResolveFailure} and
 * {@link resolveFailureToSkipped} for the two translation layers.
 *
 * The failure kinds are a strict subset of {@link SkippedActionReason}: each
 * `ResolveFailure.kind` maps directly to the matching reason, so
 * {@link parseSingleAction} can translate without a lookup table. The
 * remaining reasons (`params_parse_failed`, `state_drift`) are produced by
 * sibling stages — {@link parseParams} and {@link updateSimulatedVariant}
 * respectively — not by resolution.
 */
function resolveAction(
  item: RawActionExecution,
  lookups: ValidationLookups,
  sim: SimulationState,
): Result<ResolvedAction, ResolveFailure> {
  const instance = lookups.instanceMap.get(item.instanceId);
  if (!instance) {
    return err({ kind: 'unknown_instance' });
  }

  const vessel = lookups.vesselMap.get(instance.vesselId);
  if (!vessel) {
    return err({ kind: 'unknown_vessel', vesselId: instance.vesselId });
  }

  const currentVariant = sim.variants.get(item.instanceId);
  if (!currentVariant) {
    return err({ kind: 'no_simulated_variant' });
  }

  const variantDef = vessel.variants[currentVariant];
  if (!variantDef) {
    return err({
      kind: 'variant_not_on_vessel',
      vesselId: vessel.id,
      variant: currentVariant,
    });
  }

  const actionDef = variantDef.actions.find((a) => a.name === item.action);
  if (!actionDef) {
    const validActions = variantDef.actions.map((a) => a.name);
    return err({
      kind: 'action_not_valid',
      vesselId: instance.vesselId,
      variant: currentVariant,
      validActions,
    });
  }

  return ok({ instance, vessel, currentVariant, variantDef, actionDef });
}

/**
 * Advances the simulated variant state after a successful action validation.
 *
 * VesselSchema statically rejects vessels whose `transitionsTo` targets are
 * missing, so the only way to reach the drift branch below at runtime is
 * live mutation of a registered vessel — i.e. state drift between the
 * validated definition and the object the engine is looking at now.
 *
 * Returns `true` when the simulation either advanced cleanly or the action
 * had no `transitionsTo`, and `false` when drift was detected. The caller
 * must drop the action on `false`: returning it would let the runtime
 * attempt a transition the engine just declared impossible and leave
 * subsequent validation out of sync with runtime state.
 */
function updateSimulatedVariant(
  item: RawActionExecution,
  resolved: ResolvedAction,
  logger: Logger,
  sim: SimulationState,
): boolean {
  const { actionDef, vessel, instance, currentVariant } = resolved;
  if (!actionDef.transitionsTo) return true;

  const targetVariant = actionDef.transitionsTo;
  if (!vessel.variants[targetVariant]) {
    logger.error(
      `Vessel state drift: action "${item.action}" transitions to variant "${targetVariant}" which is no longer present on vessel "${vessel.id}" (schema would reject this; vessel object must have been mutated after registration), dropping action`,
    );
    return false;
  }

  logger.debug(
    `Simulated variant transition: instance "${item.instanceId}" (${instance.vesselId}) "${currentVariant}" -> "${targetVariant}"`,
  );
  sim.variants.set(item.instanceId, targetVariant);
  return true;
}

// ---------------------------------------------------------------------------
// Single action parsing with variant state simulation
// ---------------------------------------------------------------------------

/**
 * Parses and validates a single raw action. Ordering contract:
 * {@link updateSimulatedVariant} runs only after every earlier check passes,
 * including {@link parseParams} when `paramsJson` is present. A dropped
 * action must not advance the simulation — subsequent actions on the same
 * instance need to see the pre-drop variant, which is the invariant the
 * params-parse-failure and no-transitionsTo tests pin.
 */
function parseSingleAction(
  item: RawActionExecution,
  lookups: ValidationLookups,
  sim: SimulationState,
  skippedActions: SkippedAction[],
): ActionExecution[] {
  const resolution = resolveAction(item, lookups, sim);
  if (isErr(resolution)) {
    logResolveFailure(item, resolution.error, lookups.logger);
    skippedActions.push(resolveFailureToSkipped(item, resolution.error));
    return [];
  }
  const resolved = resolution.value;

  const brandedInstanceId = InstanceId(item.instanceId);

  if (!item.paramsJson) {
    if (!updateSimulatedVariant(item, resolved, lookups.logger, sim)) {
      skippedActions.push(stateDriftSkipped(item, resolved));
      return [];
    }
    return [{ instanceId: brandedInstanceId, action: item.action }];
  }

  const params = parseParams(
    item.paramsJson,
    item.action,
    item.instanceId,
    lookups.logger,
  );

  // paramsJson was provided but couldn't be parsed — skip the action entirely.
  // The runtime will never execute it, so the simulated variant must not
  // advance either: subsequent actions still see the pre-drop variant.
  if (params === undefined) {
    skippedActions.push({
      instanceId: item.instanceId,
      action: item.action,
      reason: 'params_parse_failed',
      detail: item.paramsJson,
    });
    return [];
  }

  if (!updateSimulatedVariant(item, resolved, lookups.logger, sim)) {
    skippedActions.push(stateDriftSkipped(item, resolved));
    return [];
  }
  return [{ instanceId: brandedInstanceId, action: item.action, params }];
}

/**
 * Builds the {@link SkippedAction} entry recorded when
 * {@link updateSimulatedVariant} rejects a transition because the target
 * variant has disappeared from the vessel definition. Kept next to
 * {@link resolveFailureToSkipped} so the two translation layers — resolve
 * failures and post-resolve drift — live side by side.
 */
function stateDriftSkipped(
  item: RawActionExecution,
  resolved: ResolvedAction,
): SkippedAction {
  return {
    instanceId: item.instanceId,
    action: item.action,
    reason: 'state_drift',
    detail: `targetVariant=${resolved.actionDef.transitionsTo}, vesselId=${resolved.vessel.id}`,
  };
}

/**
 * Emits the per-reason log line for a resolution failure. Kept here rather
 * than inside {@link resolveAction} so that resolution itself is a pure
 * `Result` producer — logging, diagnostics, and structured failure data all
 * branch from the same `ResolveFailure` value at one call site.
 *
 * Severity is fixed per kind: LLM-sourced mistakes (`unknown_instance`,
 * `unknown_vessel`, `action_not_valid`) log at `warn`; drift and engine
 * invariant violations (`no_simulated_variant`, `variant_not_on_vessel`)
 * log at `error` so alert rules can distinguish the two classes.
 */
function logResolveFailure(
  item: RawActionExecution,
  failure: ResolveFailure,
  logger: Logger,
): void {
  switch (failure.kind) {
    case 'unknown_instance':
      logger.warn(
        `Execution plan references unknown instanceId "${item.instanceId}", skipping action "${item.action}"`,
      );
      return;
    case 'unknown_vessel':
      logger.warn(
        `Execution plan references unknown vesselId "${failure.vesselId}" for instance "${item.instanceId}", skipping action "${item.action}"`,
      );
      return;
    case 'no_simulated_variant':
      // Engine invariant violation: sim.variants is initialized from the same
      // instances array that populates instanceMap. If instanceMap.get(...)
      // succeeded, sim.variants.get(...) cannot return undefined — this
      // branch is only reachable via an engine bug, so log at error so it
      // doesn't get buried among per-action LLM warnings.
      logger.error(
        `Engine invariant violation: instance "${item.instanceId}" present in instanceMap but missing from simulated variant state, skipping action "${item.action}"`,
      );
      return;
    case 'variant_not_on_vessel':
      // Reachable only via a bad instance snapshot in the request or
      // post-registration vessel mutation — state drift between caller-
      // supplied state and registered vessel definitions. Same failure class
      // as updateSimulatedVariant's drift branch; logged at error for
      // severity consistency so log aggregators can group both under one alert.
      logger.error(
        `Vessel state drift: instance "${item.instanceId}" declares variant "${failure.variant}" which is not defined on vessel "${failure.vesselId}", skipping action "${item.action}"`,
      );
      return;
    case 'action_not_valid':
      logger.warn(
        `Action "${item.action}" is not valid for vessel "${failure.vesselId}" in variant "${failure.variant}" (valid: ${failure.validActions.join(', ') || 'none'}), skipping`,
      );
      return;
    default: {
      const _exhaustive: never = failure;
      throw new Error(
        `Unhandled ResolveFailure kind: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Translates a {@link ResolveFailure} into the {@link SkippedAction} shape
 * consumed by the retry pipeline. Each failure kind maps to the
 * corresponding {@link SkippedActionReason} and preserves the contextual
 * fields (vessel id, variant, valid actions) as a human-readable `detail`.
 */
function resolveFailureToSkipped(
  item: RawActionExecution,
  failure: ResolveFailure,
): SkippedAction {
  const base = { instanceId: item.instanceId, action: item.action } as const;
  switch (failure.kind) {
    case 'unknown_instance':
      return { ...base, reason: 'unknown_instance' };
    case 'unknown_vessel':
      return {
        ...base,
        reason: 'unknown_vessel',
        detail: `vesselId=${failure.vesselId}`,
      };
    case 'no_simulated_variant':
      return { ...base, reason: 'no_simulated_variant' };
    case 'variant_not_on_vessel':
      return {
        ...base,
        reason: 'variant_not_on_vessel',
        detail: `vesselId=${failure.vesselId}, variant=${failure.variant}`,
      };
    case 'action_not_valid':
      return {
        ...base,
        reason: 'action_not_valid',
        detail: `vesselId=${failure.vesselId}, variant=${failure.variant}, validActions=[${failure.validActions.join(', ')}]`,
      };
    default: {
      const _exhaustive: never = failure;
      throw new Error(
        `Unhandled ResolveFailure kind: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main execution plan parsing function
// ---------------------------------------------------------------------------

function parseExecutionPlan(
  plan: readonly RawActionExecution[],
  instances: readonly VesselInstanceSnapshot[],
  vessels: readonly Vessel[],
  logger: Logger,
): { plan: ActionExecution[]; skippedActions: SkippedAction[] } {
  const lookups: ValidationLookups = {
    instanceMap: new Map(instances.map((i) => [i.instanceId, i])),
    vesselMap: new Map(vessels.map((v) => [v.id, v])),
    logger,
  };

  // Initialize simulated variant state from request instances.
  const sim: SimulationState = {
    variants: new Map(instances.map((i) => [i.instanceId, i.variant])),
  };

  // Owned internally — parseSingleAction pushes drops into this accumulator
  // and the final shape is returned to the caller alongside the plan.
  const skippedActions: SkippedAction[] = [];

  // Process each action in the plan, tracking variant transitions.
  // Iteration is sequential: `sim` mutates between iterations, so each
  // action validates against the variant left by the previous one.
  // Reordering or parallelizing would break the validation contract.
  // Per-action warnings inside parseSingleAction are already strictly more
  // informative than any aggregate — a summary would just double-log.
  const resultPlan = plan.flatMap((item) =>
    parseSingleAction(item, lookups, sim, skippedActions),
  );

  return { plan: resultPlan, skippedActions };
}
