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
    };
