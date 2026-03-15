/** biome-ignore-all lint/style/noNonNullAssertion: for tests only */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import { createMockResponse } from '../../../test-utils/mocks.js';
import type { MessageProcessorEvents } from './message-processor.js';
import { MessageProcessor } from './message-processor.js';

type MessageStartEvent = MessageProcessorEvents['message_start'];
type MessageCompleteEvent = MessageProcessorEvents['message_complete'];

describe('MessageProcessor Events', () => {
  let processor: MessageProcessor;
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
    processor = new MessageProcessor();
  });

  afterEach(() => {
    clock.uninstall();
  });

  describe('event payloads', () => {
    it('should include message reference and timestamp in message_start', async () => {
      let receivedEvent: MessageStartEvent | null = null;

      processor.events.on('message_start', (event) => {
        receivedEvent = event;
      });

      const response = createMockResponse('req-1', 'instance-1', 'action-1');
      processor.processMessage(response);
      await processor.waitForIdle();

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent!.message).toBe(response);
      expect(receivedEvent!.timestamp).toBeGreaterThanOrEqual(0);
    });

    it('should include duration and message in message_complete', async () => {
      let receivedEvent: MessageCompleteEvent | null = null;

      processor.events.on('message_complete', (event) => {
        receivedEvent = event;
      });

      const response = createMockResponse('req-1', 'instance-1', 'action-1');
      processor.processMessage(response);
      await processor.waitForIdle();

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent!.duration).toBeGreaterThanOrEqual(0);
      expect(receivedEvent!.message).toBe(response);
    });

    it('should emit start before complete for each message', async () => {
      const eventOrder: string[] = [];

      processor.events.on('message_start', () => {
        eventOrder.push('message_start');
      });

      processor.events.on('message_complete', () => {
        eventOrder.push('message_complete');
      });

      const response = createMockResponse('req-1', 'instance-1', 'action-1');
      processor.processMessage(response);
      await processor.waitForIdle();

      expect(eventOrder).toEqual(['message_start', 'message_complete']);
    });
  });

  describe('queued message ordering', () => {
    it('should emit message_complete events in FIFO order', async () => {
      const completedIds: string[] = [];

      processor.events.on('message_complete', (event) => {
        completedIds.push(event.message.requestId);
      });

      processor.processMessage(createMockResponse('req-1', 'i-1', 'a-1'));
      processor.processMessage(createMockResponse('req-2', 'i-2', 'a-2'));
      processor.processMessage(createMockResponse('req-3', 'i-3', 'a-3'));

      await clock.runAllAsync();

      expect(completedIds).toEqual(['req-1', 'req-2', 'req-3']);
    });
  });
});
