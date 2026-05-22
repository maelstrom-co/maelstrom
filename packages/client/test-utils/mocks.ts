import {
  ActionName,
  InstanceId,
  type MaelstromResponse,
  type MessageId,
  type TilingLayout,
  VariantName,
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
  executionPlan: [{ instanceId: InstanceId(instanceId), action: ActionName(action) }],
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
