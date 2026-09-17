import type {
  ActionName,
  GridResponse,
  InstanceId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

export type RawActionExecution = GridResponse['executionPlan'][number];

export type ParamValidationIssue =
  | { readonly kind: 'params_not_allowed' }
  | { readonly kind: 'unknown_parameter'; readonly parameter: string }
  | { readonly kind: 'missing_parameter'; readonly parameter: string }
  | {
      readonly kind: 'type_mismatch';
      readonly parameter: string;
      readonly expected: 'string' | 'number' | 'boolean' | 'object';
      readonly actual:
        | 'string'
        | 'number'
        | 'boolean'
        | 'object'
        | 'array'
        | 'null';
    }
  | { readonly kind: 'enum_violation'; readonly parameter: string };

/** Fixed, name- and value-free reason that parameter work stopped. */
export type ParamsLimitKind =
  | 'params_json_bytes'
  | 'top_level_keys'
  | 'depth'
  | 'traversal_work'
  | 'comparison_work'
  | 'validation_issues';

/**
 * Discriminated record of an action the engine refused to plan. Keep the
 * union closed and the per-arm field set stable — callers exhaust it via
 * `switch (s.reason)` and read the structured fields directly.
 */
export type SkippedAction = {
  /** Zero-based source position in the proposed execution plan. */
  readonly index?: number;
} & (
  | {
      readonly reason: 'unknown_instance';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
    }
  | {
      readonly reason: 'unknown_vessel';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
    }
  | {
      readonly reason: 'no_simulated_variant';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
    }
  | {
      readonly reason: 'variant_not_on_vessel';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
      readonly variant: VariantName;
    }
  | {
      readonly reason: 'action_not_valid';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
      readonly variant: VariantName;
      readonly validActions: readonly ActionName[];
    }
  | {
      readonly reason: 'params_parse_failed';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
    }
  | {
      readonly reason: 'params_validation_failed';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly issues: readonly ParamValidationIssue[];
    }
  | {
      readonly reason: 'params_limits_exceeded';
      readonly limit: ParamsLimitKind;
    }
  | {
      readonly reason: 'invalid_action_definition';
    }
  | {
      readonly reason: 'state_drift';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
      readonly targetVariant: VariantName;
    }
  // Action absent from the simulator's current variant for this instance,
  // but present elsewhere on the vessel with `transitionsTo` equal to that
  // current variant — i.e. a transition action whose target is where the
  // instance already is. The action would be a no-op even if it were valid
  // on the current variant; the LLM emitted it (often alongside a direct
  // mutation in layout.instances) and re-prompting the LLM cannot fix the
  // pattern. `deriveRetryHint` excludes this from `anySkipFixable` so the
  // retry layer doesn't waste calls on it.
  | {
      readonly reason: 'self_transition_noop';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
      readonly currentVariant: VariantName;
    }
  // Action not declared `idempotent` on a turn whose only trigger was a chart
  // resize. The Engine cannot see Vessel contents, so it cannot tell such an
  // action apart from one it already ran on an earlier turn, and re-prompting
  // cannot resolve the ambiguity — `deriveRetryHint` excludes this from
  // `anySkipFixable`.
  | {
      readonly reason: 'non_idempotent_on_resize';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
    }
  // Action declared `idempotent` but emitted with parameters on a turn whose
  // only trigger was a chart resize. A resize supplies no intent, so a
  // parameter value can only have come from the conversation history, which
  // makes the emission a replay however the declaration reads. Re-prompting
  // shows the LLM the same state, so `deriveRetryHint` excludes this from
  // `anySkipFixable` alongside `non_idempotent_on_resize`.
  | {
      readonly reason: 'parameterized_on_resize';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
    }
);

/**
 * The parts of a {@link SkippedAction} that name which action was refused.
 *
 * `instanceId`, `action` and `vesselId` are each absent from at least one arm
 * of the union, so every field but `reason` is optional.
 */
export type SkippedActionIdentity = {
  readonly reason: SkippedAction['reason'];
  readonly instanceId?: InstanceId;
  readonly action?: ActionName;
  readonly vesselId?: VesselId;
};

/**
 * Projects a {@link SkippedAction} down to the fields that identify it,
 * dropping the per-reason evidence a diagnostic renderer needs.
 */
export function skippedActionIdentity(
  entry: SkippedAction,
): SkippedActionIdentity {
  return {
    reason: entry.reason,
    ...('instanceId' in entry ? { instanceId: entry.instanceId } : {}),
    ...('action' in entry ? { action: entry.action } : {}),
    ...('vesselId' in entry ? { vesselId: entry.vesselId } : {}),
  };
}
