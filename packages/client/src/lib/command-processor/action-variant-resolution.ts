import {
  type ActionName,
  VariantName,
  type VesselDefinition,
} from '@maelstrom-co/protocol';

import type { ActionVariantResolution } from './action-manager.js';

export function resolveActionOnVariant(
  vessel: VesselDefinition,
  variant: VariantName,
  action: ActionName,
): Extract<
  ActionVariantResolution,
  { status: 'available' | 'action_not_on_variant' }
> {
  const definition = Object.hasOwn(vessel.variants, variant)
    ? vessel.variants[variant]?.actions.find(
        (candidate) => candidate.name === action,
      )
    : undefined;
  if (!definition) {
    return { status: 'action_not_on_variant', variant };
  }
  const target = definition.transitionsTo;
  return {
    status: 'available',
    variant,
    transition:
      target === undefined
        ? { kind: 'none' }
        : Object.hasOwn(vessel.variants, target)
          ? { kind: 'to', variant: VariantName(target) }
          : { kind: 'unknown_target', target },
  };
}
