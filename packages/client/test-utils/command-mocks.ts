import { InstanceId, type TilingLayout } from '@maelstrom-co/protocol';
import type { Command } from '../src/lib/command-processor/command.types.js';

export function createSetLayoutCommand(instanceId: string): Command {
  return {
    kind: 'set_layout',
    layout: createMockLayout(instanceId),
  };
}

export function createExecuteActionsCommand(
  instanceId: string,
  action: string,
): Command {
  return {
    kind: 'execute_actions',
    executionPlan: [{ instanceId: InstanceId(instanceId), action }],
  };
}

export function createMockLayout(instanceId: string): TilingLayout {
  return {
    type: 'tiling',
    tree: [],
    instances: [
      {
        instanceId: InstanceId(instanceId),
        vesselId: 'vessel-1',
        variant: 'default',
      },
    ],
  };
}
