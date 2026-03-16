import type {
  MaelstromResponse,
  TilingLayout,
} from '@maelstrom-co/protocol-old';

export const createMockResponse = (
  requestId: string,
  instanceId: string,
  action: string,
): MaelstromResponse => ({
  type: 'maelstrom_response',
  requestId,
  userMessage: 'ok',
  rationale: 'test',
  executionPlan: [{ instanceId, action }],
  layout: createMockLayout(instanceId),
});

export const createMockLayout = (instanceId: string): TilingLayout => ({
  type: 'tiling',
  tree: [],
  instances: [
    {
      instanceId,
      vesselId: 'vessel-1',
      variant: 'default',
    },
  ],
});
