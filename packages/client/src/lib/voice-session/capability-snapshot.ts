import type {
  ActionName,
  VariantName,
  Vessel,
  VesselId,
} from '@maelstrom-co/protocol';

/**
 * An action available on a vessel, deduplicated by name across all of its
 * variants — the model needs to know what a vessel can do, not which
 * variant happens to expose the action.
 */
export interface VesselCapabilityAction {
  readonly name: ActionName;
  readonly description: string;
}

/** A variant a vessel can be shown in. */
export interface VesselCapabilityVariant {
  readonly name: VariantName;
  readonly description?: string;
}

/**
 * Conversational catalog entry for one registered vessel: its purpose, the
 * variants it can be shown in, and the actions that can transform it.
 * Deliberately excludes action parameters, size constraints, and props —
 * this answers "what can be shown", not "how to plan a layout".
 */
export interface VesselCapability {
  readonly vesselId: VesselId;
  readonly description: string;
  readonly variants: readonly VesselCapabilityVariant[];
  readonly actions: readonly VesselCapabilityAction[];
}

/**
 * The full capability catalog: every registered vessel's purpose, variants,
 * and actions. Source of truth for the `get_capabilities` voice tool —
 * answers "what can you show me?" the way {@link UIStructuralSnapshot}
 * answers "what's on screen right now?".
 */
export interface CapabilitySnapshot {
  readonly vessels: readonly VesselCapability[];
}

/** Pure projection from the registered vessels to a conversational capability catalog. */
export function readCapabilitySnapshot(
  vessels: readonly Vessel[],
): CapabilitySnapshot {
  return {
    vessels: vessels.map(({ id, description, variants }) => {
      const actionsByName = new Map<ActionName, VesselCapabilityAction>();
      for (const variant of Object.values(variants)) {
        for (const action of variant.actions) {
          if (!actionsByName.has(action.name)) {
            actionsByName.set(action.name, {
              name: action.name,
              description: action.description,
            });
          }
        }
      }

      return {
        vesselId: id,
        description,
        variants: Object.entries(variants).map(([name, variant]) => ({
          name: name as VariantName,
          ...(variant.description !== undefined
            ? { description: variant.description }
            : {}),
        })),
        actions: [...actionsByName.values()],
      };
    }),
  };
}
