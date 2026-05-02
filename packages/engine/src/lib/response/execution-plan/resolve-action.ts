import type {
  ActionName,
  Result,
  Vessel,
  VesselAction,
  VesselId,
  VesselInstanceSnapshot,
  VesselVariant,
  VariantName,
} from '@maelstrom-co/protocol';
import { err, ok } from '@maelstrom-co/protocol';

import { assertNever } from '../../assert-never.js';
import type { Logger } from '../../logger.js';
import type {
  RawActionExecution,
  SkippedAction,
  SimulationState,
  ValidationLookups,
} from './validation-context.js';

export interface ResolvedAction {
  readonly instance: VesselInstanceSnapshot;
  readonly vessel: Vessel;
  readonly currentVariant: VariantName;
  readonly variantDef: VesselVariant;
  readonly actionDef: VesselAction;
}

export type ResolveFailure =
  | { readonly kind: 'unknown_instance' }
  | { readonly kind: 'unknown_vessel'; readonly vesselId: VesselId }
  | { readonly kind: 'no_simulated_variant' }
  | {
      readonly kind: 'variant_not_on_vessel';
      readonly vesselId: VesselId;
      readonly variant: VariantName;
    }
  | {
      readonly kind: 'action_not_valid';
      readonly vesselId: VesselId;
      readonly variant: VariantName;
      readonly validActions: readonly ActionName[];
    };

// Compile-time witness: every `ResolveFailure.kind` must also be a
// `SkippedAction['reason']`. A new kind without a matching arm fails this
// line — the hand-mapping in `resolveFailureToSkipped` below would
// otherwise drift silently. Exported to satisfy `noUnusedLocals`; the
// underscore prefix signals internal-only and the package barrel does not
// re-export it.
type _AssertTrue<T extends true> = T;
export type _KindsCoverReasons = _AssertTrue<
  ResolveFailure['kind'] extends SkippedAction['reason'] ? true : never
>;

export function resolveAction(
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

export function stateDriftSkipped(
  item: RawActionExecution,
  resolved: ResolvedAction,
  targetVariant: VariantName,
): SkippedAction {
  return {
    reason: 'state_drift',
    instanceId: item.instanceId,
    action: item.action,
    vesselId: resolved.vessel.id,
    targetVariant,
  };
}

/**
 * Severity is fixed per kind: LLM-sourced mistakes (`unknown_instance`,
 * `unknown_vessel`, `action_not_valid`) log at `warn`; drift and engine
 * invariant violations (`no_simulated_variant`, `variant_not_on_vessel`)
 * log at `error` so alert rules can distinguish the two classes.
 */
export function logResolveFailure(
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
    default:
      assertNever(failure, 'Unhandled ResolveFailure kind');
  }
}

export function resolveFailureToSkipped(
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
        vesselId: failure.vesselId,
      };
    case 'no_simulated_variant':
      return { ...base, reason: 'no_simulated_variant' };
    case 'variant_not_on_vessel':
      return {
        ...base,
        reason: 'variant_not_on_vessel',
        vesselId: failure.vesselId,
        variant: failure.variant,
      };
    case 'action_not_valid':
      return {
        ...base,
        reason: 'action_not_valid',
        vesselId: failure.vesselId,
        variant: failure.variant,
        validActions: failure.validActions,
      };
    default:
      assertNever(failure, 'Unhandled ResolveFailure kind');
  }
}
