import type {
  ActionName,
  GridResponse,
  InstanceId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

export type RawActionExecution = GridResponse['executionPlan'][number];

/**
 * Discriminated record of an action the engine refused to plan. Keep the
 * union closed and the per-arm field set stable — callers exhaust it via
 * `switch (s.reason)` and read the structured fields directly.
 */
export type SkippedAction =
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
      readonly paramsJson: string;
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
    };
