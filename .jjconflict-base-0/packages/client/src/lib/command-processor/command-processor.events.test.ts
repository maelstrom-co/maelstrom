import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import { createSetLayoutCommand } from '../../../test-utils/command-mocks.js';
import type { Command } from './command.types.js';
import type { CommandProcessorEvents } from './command-processor.js';
import { CommandProcessor } from './command-processor.js';

type CommandStartEvent = CommandProcessorEvents['command_start'];
type CommandCompleteEvent = CommandProcessorEvents['command_complete'];

describe('CommandProcessor Events', () => {
  let processor: CommandProcessor;
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
    processor = new CommandProcessor();
  });

  afterEach(() => {
    processor.dispose();
    clock.uninstall();
  });

  describe('event payloads', () => {
    it('should include command reference and timestamp in command_start', async () => {
      const receivedEvents: CommandStartEvent[] = [];

      processor.events.on('command_start', (event) => {
        receivedEvents.push(event);
      });

      const command = createSetLayoutCommand('instance-1');
      processor.dispatch(command);
      await processor.waitForIdle();

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].command).toBe(command);
      expect(receivedEvents[0].timestamp).toBeGreaterThanOrEqual(0);
    });

    it('should include duration and command in command_complete', async () => {
      const receivedEvents: CommandCompleteEvent[] = [];

      processor.events.on('command_complete', (event) => {
        receivedEvents.push(event);
      });

      const command = createSetLayoutCommand('instance-1');
      processor.dispatch(command);
      await processor.waitForIdle();

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].duration).toBeGreaterThanOrEqual(0);
      expect(receivedEvents[0].command).toBe(command);
    });

    it('should emit start before complete for each command', async () => {
      const eventOrder: string[] = [];

      processor.events.on('command_start', () => {
        eventOrder.push('command_start');
      });

      processor.events.on('command_complete', () => {
        eventOrder.push('command_complete');
      });

      const command = createSetLayoutCommand('instance-1');
      processor.dispatch(command);
      await processor.waitForIdle();

      expect(eventOrder).toEqual(['command_start', 'command_complete']);
    });
  });

  describe('queued command ordering', () => {
    it('should emit command_complete events in FIFO order', async () => {
      const completedCommands: Command[] = [];

      processor.events.on('command_complete', (event) => {
        completedCommands.push(event.command);
      });

      const cmd1 = createSetLayoutCommand('i-1');
      const cmd2 = createSetLayoutCommand('i-2');
      const cmd3 = createSetLayoutCommand('i-3');

      processor.dispatch(cmd1);
      processor.dispatch(cmd2);
      processor.dispatch(cmd3);

      await clock.runAllAsync();

      expect(completedCommands).toEqual([cmd1, cmd2, cmd3]);
    });
  });
});
