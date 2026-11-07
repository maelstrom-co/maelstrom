import type { InstanceId, TilingLayout } from '@maelstrom-co/protocol';

import type { VesselInstance } from '../types.js';

// Action transitions update only the live Instances, so the stored layout can
// still declare the pre-action Variant.
export function withLiveVariants(
  layout: TilingLayout,
  liveInstances: ReadonlyMap<InstanceId, Pick<VesselInstance, 'variant'>>,
): TilingLayout {
  return {
    ...layout,
    instances: layout.instances.map((declaration) => {
      const live = liveInstances.get(declaration.instanceId);
      return live === undefined || live.variant === declaration.variant
        ? declaration
        : { ...declaration, variant: live.variant };
    }),
  };
}
