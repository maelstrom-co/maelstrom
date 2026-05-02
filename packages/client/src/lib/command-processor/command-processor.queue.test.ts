import { beforeEach, describe, expect, it } from 'bun:test';

import { InstanceId } from '@maelstrom-co/protocol';

import { createSetLayoutCommand } from '../../../test-utils/command-mocks.js';
import type { Command } from './command.types.js';
import { CommandProcessor } from './command-processor.js';

describe('CommandProcessor Queue Timing', () => {
  let processor: CommandProcessor;

  beforeEach(() => {
    processor = new CommandProcessor({ defaultActionWaitTimeoutMs: 0 });
  });

  /**
   * When two commands are dispatched synchronously, the first's layout phase
   * completes before the second's dispatch call runs, because
   * applyLayout is synchronous. The first await happens at the async boundary
   * in the event loop.
   */
  it('should queue second command before first command hits first await', async () => {
    const statusChecks: Array<{
      kind: string;
      status: string;
      isProcessing: boolean;
    }> = [];

    const command1 = createSetLayoutCommand('instance-1');
    const command2 = createSetLayoutCommand('instance-2');

    const originalDispatch = processor.dispatch.bind(processor);
    processor.dispatch = (cmd: Command) => {
      const status = processor.store.state.status;
      const isProcessing = status !== 'idle';
      statusChecks.push({
        kind: cmd.kind,
        status,
        isProcessing,
      });
      return originalDispatch(cmd);
    };

    processor.dispatch(command1);
    processor.dispatch(command2);

    expect(statusChecks).toHaveLength(2);

    // cmd1 saw 'idle' status (first caller)
    expect(statusChecks[0]).toEqual({
      kind: 'set_layout',
      status: 'idle',
      isProcessing: false,
    });

    // cmd2 saw 'processing' because cmd1's entire layout phase
    // completed synchronously before the first await at the async boundary
    expect(statusChecks[1]).toEqual({
      kind: 'set_layout',
      status: 'processing',
      isProcessing: true,
    });

    await processor.waitForIdle();

    expect(processor.store.state.status).toBe('idle');
    expect(processor.queueLength).toBe(0);
    expect(processor.store.state.instances.has(InstanceId('instance-2'))).toBe(
      true,
    );
  });

  it('should process sequentially when awaited between calls', async () => {
    const executionOrder: string[] = [];

    const command1 = createSetLayoutCommand('instance-1');
    const command2 = createSetLayoutCommand('instance-2');

    processor.events.on('command_complete', (event) => {
      executionOrder.push(event.command.kind);
    });

    processor.dispatch(command1);
    await processor.waitForIdle();
    processor.dispatch(command2);
    await processor.waitForIdle();

    expect(executionOrder).toEqual(['set_layout', 'set_layout']);
    expect(processor.store.state.status).toBe('idle');
  });

  it('should use queue for rapid-fire commands without await', async () => {
    const commands = Array.from({ length: 5 }, (_, i) =>
      createSetLayoutCommand(`instance-${i}`),
    );

    commands.forEach((cmd) => {
      processor.dispatch(cmd);
    });

    // First command is already in 'processing' phase
    expect(processor.store.state.status).toBe('processing');
    // Commands 2-5 should be in queue
    expect(processor.queueLength).toBe(4);

    await processor.waitForIdle();

    expect(processor.store.state.status).toBe('idle');
    expect(processor.queueLength).toBe(0);
  });
});
