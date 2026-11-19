import { expect, test } from 'bun:test';

import { Orchestrator } from '@maelstrom-co/client';

import { GoalRunner } from './goal-runner';
import { WorkspaceConnector } from './workspace-connector';

test('a lost stop notification cannot hide an uncertain goal outcome or admit another goal', async () => {
  const connector = new WorkspaceConnector(async () => {
    throw new Error('No UI application expected');
  });
  const orchestrator = new Orchestrator(connector);
  let stopSignal: AbortSignal | undefined;
  const runner = new GoalRunner(
    'thread',
    async (path, _body, signal) => {
      if (path === '/api/workspace/stop') {
        stopSignal = signal;
        return new Promise<Response>(() => {});
      }
      throw new Error('Goal response lost');
    },
    connector,
    orchestrator,
  );
  try {
    const result = await runner.run('Create a Journal entry.');
    expect(result.status).toBe('unknown');
    expect(stopSignal).toBeDefined();
    await expect(runner.run('Try again')).rejects.toThrow('stopped');
  } finally {
    await orchestrator.dispose();
  }
});
