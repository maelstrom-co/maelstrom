import {
  InstanceId,
  type MaelstromResponse,
  type MessageId,
  type TilingLayout,
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
  executionPlan: [{ instanceId: InstanceId(instanceId), action }],
  layout: createMockLayout(instanceId),
});

export const createMockLayout = (instanceId: string): TilingLayout => ({
  type: 'tiling',
  tree: [],
  instances: [
    {
      instanceId: InstanceId(instanceId),
      vesselId: 'vessel-1',
      variant: 'default',
    },
  ],
});
