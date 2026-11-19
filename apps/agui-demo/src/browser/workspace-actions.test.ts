import { expect, spyOn, test } from 'bun:test';

import { CommandProcessor } from '@maelstrom-co/client';
import {
  ActionName,
  InstanceId,
  ok,
  TilingLayoutSchema,
} from '@maelstrom-co/protocol';

import { emptyRecords } from '../records';
import { bindWorkspaceActions } from './workspace-actions';
import { WorkspaceConnector } from './workspace-connector';
import { WorkspaceState } from './workspace-state';

test('removed or retired Instances lose their handlers, including when an ID is reused by another Vessel', async () => {
  const processor = new CommandProcessor({ defaultActionWaitTimeoutMs: 5 });
  const connector = new WorkspaceConnector(async () => []);
  const state = new WorkspaceState(emptyRecords(), connector, async () => {
    throw new Error('Unexpected record request');
  });
  const action = spyOn(state, 'action').mockResolvedValue(ok(undefined));
  const dispose = bindWorkspaceActions(processor, state);
  const instanceId = InstanceId('retained');
  const layout = async (vesselId?: string) =>
    processor.dispatchSettled({
      kind: 'set_layout',
      layout: {
        type: 'tiling',
        ...TilingLayoutSchema.parse({
          type: 'tiling',
          tree: [],
          instances: vesselId
            ? [{ instanceId, vesselId, variant: 'list' }]
            : [],
        }),
      },
    });
  const run = (name: string) =>
    processor.runLocalAction({ instanceId, action: ActionName(name) });
  try {
    await layout('tasks');
    expect(await run('addTask')).toBe('succeeded');
    await layout('labs');
    expect(await run('addTask')).not.toBe('succeeded');
    expect(action).toHaveBeenCalledTimes(1);
    expect(await run('showList')).toBe('succeeded');
    await layout();
    expect(await run('showList')).toBe('skipped');
    expect(action).toHaveBeenCalledTimes(2);
    await layout('tasks');
    dispose();
    expect(await run('addTask')).toBe('skipped');
    await layout('labs');
    expect(await run('showList')).toBe('skipped');
    expect(action).toHaveBeenCalledTimes(2);
  } finally {
    dispose();
    action.mockRestore();
    state.dispose();
    processor.dispose();
    await connector.disconnect();
  }
});

test('persistent handlers still reject unissued effects before changing application state', async () => {
  const processor = new CommandProcessor();
  const connector = new WorkspaceConnector(async () => []);
  const state = new WorkspaceState(emptyRecords(), connector, async () => {
    throw new Error('An unissued Action must not reach the server');
  });
  const dispose = bindWorkspaceActions(processor, state);
  try {
    await processor.dispatchSettled({
      kind: 'set_layout',
      layout: {
        type: 'tiling',
        ...TilingLayoutSchema.parse({
          type: 'tiling',
          tree: [],
          instances: [
            { instanceId: 'map', vesselId: 'map', variant: 'overview' },
          ],
        }),
      },
    });
    const outcome = await processor.runLocalAction({
      instanceId: InstanceId('map'),
      action: ActionName('focusLocation'),
      params: { name: 'Home' },
    });
    expect(outcome).toBe('failed');
    expect(state.snapshot().map).toEqual({});
  } finally {
    dispose();
    state.dispose();
    processor.dispose();
    await connector.disconnect();
  }
});
