import {
  type ChartRequest,
  getVisibleInstanceIds,
  type GridLayout,
  type InstanceId,
  type TilingLayout,
  type VesselId,
} from '@maelstrom-co/protocol';

/**
 * Returns the Vessel ids of the Instances visible in `layout`, deduplicated,
 * in layout order. An Instance resolves through the layout's own Instance
 * declarations first, then through the Chart's Instances. A visible
 * Instance neither knows is left out.
 */
export function vesselIdsOnScreen(
  layout: GridLayout | TilingLayout,
  chart: ChartRequest,
): VesselId[] {
  const vesselOf = new Map<InstanceId, VesselId>(
    chart.instances.map((instance) => [instance.instanceId, instance.vesselId]),
  );
  if (layout.type === 'tiling')
    for (const instance of layout.instances)
      vesselOf.set(instance.instanceId, instance.vesselId);
  const onScreen = new Set<VesselId>();
  for (const instanceId of getVisibleInstanceIds(layout)) {
    const vesselId = vesselOf.get(instanceId);
    if (vesselId !== undefined) onScreen.add(vesselId);
  }
  return [...onScreen];
}
