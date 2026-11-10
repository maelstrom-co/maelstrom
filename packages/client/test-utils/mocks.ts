import {
  ActionName,
  InstanceId,
  type MaelstromResponse,
  type MessageId,
  type TilingLayout,
  VariantName,
  type VesselDefinition,
  VesselId,
} from '@maelstrom-co/protocol';

export const createMockResponse = (
  requestId: MessageId,
  instanceId: string,
  action: string,
): MaelstromResponse => ({
  type: 'maelstrom_response',
  requestId,
  userMessage: 'ok',
  rationale: 'test',
  executionPlan: [
    { instanceId: InstanceId(instanceId), action: ActionName(action) },
  ],
  layout: createMockLayout(instanceId),
});

export const createMockLayout = (instanceId: string): TilingLayout => ({
  type: 'tiling',
  tree: [],
  instances: [
    {
      instanceId: InstanceId(instanceId),
      vesselId: VesselId('vessel-1'),
      variant: VariantName('default'),
    },
  ],
});

/**
 * Lightweight response for routing/correlation tests where layout and
 * execution plan are not under test. `userMessage` is parameterized so
 * concurrent-request tests can assert that responses route to the right
 * caller by content.
 */
export const createMockEmptyResponse = (
  requestId: MessageId,
  userMessage = 'ok',
): MaelstromResponse => ({
  type: 'maelstrom_response',
  requestId,
  userMessage,
  rationale: 'test',
  executionPlan: [],
  layout: { type: 'tiling', tree: [], instances: [] },
});

/**
 * The `vessel-1` definition that {@link createMockResponse} lays out: one
 * `default` Variant offering the named Actions. Register it so Engine Actions
 * resolve against the Variant instead of being skipped for an unknown Vessel.
 */
export const createMockResponseVessel = (
  ...actions: string[]
): VesselDefinition => ({
  id: 'vessel-1',
  name: 'Vessel 1',
  description: 'test vessel',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: (actions.length > 0 ? actions : ['show']).map((name) => ({
        name,
        description: name,
      })),
    },
  },
});
