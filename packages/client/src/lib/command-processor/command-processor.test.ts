import { beforeEach, describe, expect, it } from 'bun:test';
import {
  type GridLayout,
  InstanceId,
  type TilingLayout,
  tilingLeafInstanceId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import {
  createExecuteActionsCommand,
  createSetLayoutCommand,
} from '../../../test-utils/command-mocks.js';
import type { Command } from './command.types.js';
import { CommandProcessor } from './command-processor.js';

describe('CommandProcessor (Event Loop)', () => {
  let processor: CommandProcessor;

  beforeEach(() => {
    // Use 0 timeout so tests run fast - actions skipped immediately if no runner
    processor = new CommandProcessor({ defaultActionWaitTimeoutMs: 0 });
  });

  it('should start with idle status and empty instances', () => {
    expect(processor.store.state.status).toBe('idle');
    expect(processor.store.state.instances.size).toBe(0);
  });

  describe('dispatch', () => {
    it('should process a single command and return to idle', async () => {
      const command = createSetLayoutCommand('vessel-1-1');

      processor.dispatch(command);
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
    });

    it('should process multiple commands sequentially', async () => {
      const command1 = createSetLayoutCommand('vessel-1-1');
      const command2 = createSetLayoutCommand('vessel-2-1');

      processor.dispatch(command1);
      await processor.waitForIdle();
      processor.dispatch(command2);
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
    });

    it('should queue commands while processing', async () => {
      const command1 = createSetLayoutCommand('vessel-1-1');
      const command2 = createSetLayoutCommand('vessel-2-1');

      processor.dispatch(command1);
      processor.dispatch(command2);

      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
    });

    it('should throw after dispose', () => {
      processor.dispose();

      const command = createSetLayoutCommand('vessel-1-1');
      expect(() => processor.dispatch(command)).toThrow(
        'CommandProcessor is disposed',
      );
    });

    it('should resolve pending waitForIdle when dispose is called', async () => {
      const clock = FakeTimers.install({ shouldAdvanceTime: true });
      try {
        // Use a long timeout so the action runner wait blocks long enough
        const slowProcessor = new CommandProcessor({
          defaultActionWaitTimeoutMs: 60000,
        });

        const command = createExecuteActionsCommand('vessel-1-1', 'action-1');

        // Register a runner that never resolves, keeping the processor busy
        slowProcessor.registerRunner(InstanceId('vessel-1-1'), {
          'action-1': () => new Promise<never>(() => {}),
        });

        // Start processing — action will block forever
        slowProcessor.dispatch(command);

        // Give the event loop a tick so processing starts
        await clock.tickAsync(0);

        // Call waitForIdle while processing — this promise must not hang
        const idlePromise = slowProcessor.waitForIdle();

        // Dispose while waitForIdle is pending
        slowProcessor.dispose();

        // Use a race with fake timers to detect if the promise hangs
        const timeoutPromise = new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), 5000),
        );
        const racePromise = Promise.race([
          idlePromise.then(() => 'resolved' as const),
          timeoutPromise,
        ]);

        await clock.tickAsync(6000);

        const result = await racePromise;
        expect(result).toBe('resolved');
      } finally {
        clock.uninstall();
      }
    });
  });

  describe('error recovery', () => {
    it('should continue processing queued commands after an error', async () => {
      const badCommand: Command = {
        kind: 'set_layout',
        layout: { type: 'invalid' as 'tiling' },
      } as unknown as Command;

      const goodCommand = createSetLayoutCommand('instance-2');

      processor.dispatch(badCommand);
      processor.dispatch(goodCommand);

      await processor.waitForIdle();

      // The second command should have been processed despite the first failing
      expect(processor.store.state.status).toBe('idle');
      expect(
        processor.store.state.instances.has(InstanceId('instance-2')),
      ).toBe(true);
    });

    it('should emit processing_error event on failure', async () => {
      const errors: { kind: string; error: Error }[] = [];
      processor.events.on('processing_error', (event) => {
        errors.push({
          kind: event.command.kind,
          error: event.error,
        });
      });

      const badCommand: Command = {
        kind: 'set_layout',
        layout: { type: 'invalid' as 'tiling' },
      } as unknown as Command;

      processor.dispatch(badCommand);
      await processor.waitForIdle();

      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe('set_layout');
    });

    it('should set status to error then recover to idle', async () => {
      const statusTransitions: string[] = [];
      const sub = processor.store.subscribe(() => {
        statusTransitions.push(processor.store.state.status);
      });

      const badCommand: Command = {
        kind: 'set_layout',
        layout: { type: 'invalid' as 'tiling' },
      } as unknown as Command;

      processor.dispatch(badCommand);
      await processor.waitForIdle();

      sub.unsubscribe();

      expect(statusTransitions).toContain('error');
      expect(processor.store.state.status).toBe('idle');
    });
  });

  // Weighted split tokens replace the only sanctioned reason a producer had
  // to repeat a leaf, so a repeat is now a producer bug. The renderer no
  // longer bounding-boxes duplicates away, so this gate is what keeps a
  // duplicate out of the store in the first place.
  describe('duplicate tiling leaf gate', () => {
    function tilingLayout(tree: TilingLayout['tree']): TilingLayout {
      const leaves = new Set<InstanceId>();
      for (const node of tree) {
        const instanceId = tilingLeafInstanceId(node);
        if (instanceId !== null) leaves.add(instanceId);
      }
      return {
        type: 'tiling',
        tree,
        instances: [...leaves].map((instanceId) => ({
          instanceId,
          vesselId: VesselId('vessel-1'),
          variant: VariantName('default'),
        })),
      };
    }

    it('refuses a duplicate-bearing tiling layout, emitting processing_error and leaving the previous layout on screen', async () => {
      const errors: Error[] = [];
      processor.events.on('processing_error', ({ error }) => {
        errors.push(error);
      });

      const good = tilingLayout(['V', 'ID:a', 'ID:b']);
      processor.dispatch({ kind: 'set_layout', layout: good });
      await processor.waitForIdle();

      processor.dispatch({
        kind: 'set_layout',
        layout: tilingLayout(['V', 'ID:a', 'ID:a']),
      });
      await processor.waitForIdle();

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('"a"');
      // The failure mode is "the layout did not update", not a blank chart.
      expect(processor.store.state.layout).toBe(good);
      expect(processor.store.state.instances.has(InstanceId('b'))).toBe(true);
      expect(processor.store.state.status).toBe('idle');
    });

    it('abandons the rest of the batch when the layout is refused', async () => {
      // Orchestrator.#dispatchResponse pairs set_layout with the
      // execute_actions that targets the instances that layout creates, so
      // running the tail against the pre-refusal store would stall each
      // action for its readiness timeout and then record it as `skipped`
      // with an ok result — a batch reporting zero failures.
      const abandoned: Command[][] = [];
      processor.events.on('batch_abandoned', (event) => {
        abandoned.push([...event.abandoned]);
      });

      const actions = createExecuteActionsCommand('never-created', 'refresh');
      processor.dispatch(
        {
          kind: 'set_layout',
          layout: tilingLayout(['V', InstanceId('a'), InstanceId('a')]),
        },
        actions,
      );
      await processor.waitForIdle();

      expect(abandoned).toEqual([[actions]]);
      expect(processor.store.state.layout).toBeNull();
    });

    it('applies a weighted layout whose leaves are all distinct', async () => {
      const layout = tilingLayout(['V:2,1', 'ID:a', 'ID:b']);

      processor.dispatch({ kind: 'set_layout', layout });
      await processor.waitForIdle();

      expect(processor.store.state.layout).toBe(layout);
      expect(processor.store.state.instances.size).toBe(2);
      expect(processor.store.state.status).toBe('idle');
    });

    it('leaves grid layouts alone — a repeated instance there is a repositioning, not a second tile', async () => {
      const seeded = tilingLayout(['V', 'ID:a', 'ID:b']);
      processor.dispatch({ kind: 'set_layout', layout: seeded });
      await processor.waitForIdle();

      const grid: GridLayout = {
        type: 'grid',
        positions: [
          {
            instanceId: InstanceId('a'),
            position: { column: 0, row: 0 },
            size: { width: 1, height: 1 },
          },
          {
            instanceId: InstanceId('a'),
            position: { column: 1, row: 0 },
            size: { width: 1, height: 1 },
          },
        ],
      };

      processor.dispatch({ kind: 'set_layout', layout: grid });
      await processor.waitForIdle();

      expect(processor.store.state.layout).toBe(grid);
      expect(processor.store.state.status).toBe('idle');
    });
  });

  describe('stress tests', () => {
    it('should handle rapid command bursts (100 commands)', async () => {
      const commands = Array.from({ length: 100 }, (_, i) =>
        createSetLayoutCommand(`vessel-${i}`),
      );

      commands.forEach((cmd) => {
        processor.dispatch(cmd);
      });
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
      expect(processor.store.state.instances.size).toBe(1);
      expect(processor.store.state.instances.has(InstanceId('vessel-99'))).toBe(
        true,
      );
    });

    it('should handle high-volume concurrent burst', async () => {
      const commandCount = 500;
      const commands = Array.from({ length: commandCount }, (_, i) =>
        createSetLayoutCommand(`vessel-${i}`),
      );

      commands.forEach((cmd) => {
        processor.dispatch(cmd);
      });
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
      expect(processor.store.state.instances.size).toBe(1);
      expect(
        processor.store.state.instances.has(
          InstanceId(`vessel-${commandCount - 1}`),
        ),
      ).toBe(true);
    });

    it('should handle burst then idle then burst pattern', async () => {
      const burst1 = Array.from({ length: 20 }, (_, i) =>
        createSetLayoutCommand(`vessel-b1-${i}`),
      );
      burst1.forEach((cmd) => {
        processor.dispatch(cmd);
      });
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);

      const burst2 = Array.from({ length: 20 }, (_, i) =>
        createSetLayoutCommand(`vessel-b2-${i}`),
      );
      burst2.forEach((cmd) => {
        processor.dispatch(cmd);
      });
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
      expect(
        processor.store.state.instances.has(InstanceId('vessel-b2-19')),
      ).toBe(true);
    });
  });

  describe('dispatch batch (variadic)', () => {
    it('should process all commands in a batch without idle gap', async () => {
      const statusTransitions: string[] = [];
      const sub = processor.store.subscribe(() => {
        statusTransitions.push(processor.store.state.status);
      });

      processor.dispatch(
        createSetLayoutCommand('instance-1'),
        createSetLayoutCommand('instance-2'),
      );

      await processor.waitForIdle();
      sub.unsubscribe();

      // Status should go: processing → idle. Never idle between the two commands.
      const idleCount = statusTransitions.filter((s) => s === 'idle').length;
      expect(idleCount).toBe(1);
    });

    it('should emit individual events for each command in a batch', async () => {
      const events: string[] = [];
      processor.events.on('command_start', (e) => {
        events.push(`start:${e.command.kind}`);
      });
      processor.events.on('command_complete', (e) => {
        events.push(`complete:${e.command.kind}`);
      });

      processor.dispatch(
        createSetLayoutCommand('instance-1'),
        createSetLayoutCommand('instance-2'),
      );

      await processor.waitForIdle();

      expect(events).toEqual([
        'start:set_layout',
        'complete:set_layout',
        'start:set_layout',
        'complete:set_layout',
      ]);
    });

    it('should be a no-op for empty dispatch', async () => {
      processor.dispatch();
      expect(processor.store.state.status).toBe('idle');
    });

    it('should treat single-item dispatch as regular dispatch', async () => {
      processor.dispatch(createSetLayoutCommand('instance-1'));
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(
        processor.store.state.instances.has(InstanceId('instance-1')),
      ).toBe(true);
    });
  });
});
