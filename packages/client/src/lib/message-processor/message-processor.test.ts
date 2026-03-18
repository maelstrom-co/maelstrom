import { beforeEach, describe, expect, it } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import { createMockResponse } from '../../../test-utils/mocks.js';
import { MessageProcessor } from './message-processor.js';

describe('MessageProcessor (Event Loop)', () => {
  let processor: MessageProcessor;

  beforeEach(() => {
    // Use 0 timeout so tests run fast - actions skipped immediately if no runner
    processor = new MessageProcessor({ defaultActionWaitTimeoutMs: 0 });
  });

  it('should start with idle status and empty instances', () => {
    expect(processor.store.state.status).toBe('idle');
    expect(processor.store.state.instances.size).toBe(0);
  });

  describe('processMessage', () => {
    it('should process a single message and return to idle', async () => {
      const response = createMockResponse('req-1', 'vessel-1-1', 'action-1');

      processor.processMessage(response);
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
    });

    it('should process multiple messages sequentially', async () => {
      const response1 = createMockResponse('req-1', 'vessel-1-1', 'action-1');
      const response2 = createMockResponse('req-2', 'vessel-2-1', 'action-2');

      processor.processMessage(response1);
      await processor.waitForIdle();
      processor.processMessage(response2);
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
    });

    it('should queue messages while processing', async () => {
      const response1 = createMockResponse('req-1', 'vessel-1-1', 'action-1');
      const response2 = createMockResponse('req-2', 'vessel-2-1', 'action-2');

      processor.processMessage(response1);
      processor.processMessage(response2);

      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
    });

    it('should throw after dispose', () => {
      processor.dispose();

      const response = createMockResponse('req-1', 'vessel-1-1', 'action-1');
      expect(() => processor.processMessage(response)).toThrow(
        'MessageProcessor is disposed',
      );
    });

    it('should resolve pending waitForIdle when dispose is called', async () => {
      const clock = FakeTimers.install({ shouldAdvanceTime: true });
      try {
        // Use a long timeout so the action runner wait blocks long enough
        const slowProcessor = new MessageProcessor({
          defaultActionWaitTimeoutMs: 60000,
        });

        const response = createMockResponse('req-1', 'vessel-1-1', 'action-1');

        // Register a runner that never resolves, keeping the processor busy
        slowProcessor.actionManager.registerRunner('vessel-1-1', {
          'action-1': () => new Promise<never>(() => {}),
        });

        // Start processing — action will block forever
        slowProcessor.processMessage(response);

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
    it('should continue processing queued messages after an error', async () => {
      const badResponse = createMockResponse(
        'req-bad',
        'instance-1',
        'action-1',
      );
      // Corrupt the layout to trigger an error during processing
      (badResponse as unknown as Record<string, unknown>).layout = {
        type: 'invalid' as 'tiling',
      };

      const goodResponse = createMockResponse(
        'req-good',
        'instance-2',
        'action-2',
      );

      processor.processMessage(badResponse);
      processor.processMessage(goodResponse);

      await processor.waitForIdle();

      // The second message should have been processed despite the first failing
      expect(processor.store.state.status).toBe('idle');
      expect(processor.store.state.instances.has('instance-2')).toBe(true);
    });

    it('should emit processing_error event on failure', async () => {
      const errors: { requestId: string; error: Error }[] = [];
      processor.events.on('processing_error', (event) => {
        errors.push({
          requestId: event.message.requestId,
          error: event.error,
        });
      });

      const badResponse = createMockResponse(
        'req-bad',
        'instance-1',
        'action-1',
      );
      (badResponse as unknown as Record<string, unknown>).layout = {
        type: 'invalid' as 'tiling',
      };

      processor.processMessage(badResponse);
      await processor.waitForIdle();

      expect(errors).toHaveLength(1);
      expect(errors[0].requestId).toBe('req-bad');
    });

    it('should set status to error then recover to idle', async () => {
      const statusTransitions: string[] = [];
      const unsub = processor.store.subscribe(() => {
        statusTransitions.push(processor.store.state.status);
      });

      const badResponse = createMockResponse(
        'req-bad',
        'instance-1',
        'action-1',
      );
      (badResponse as unknown as Record<string, unknown>).layout = {
        type: 'invalid' as 'tiling',
      };

      processor.processMessage(badResponse);
      await processor.waitForIdle();

      unsub();

      expect(statusTransitions).toContain('error');
      expect(processor.store.state.status).toBe('idle');
    });
  });

  describe('stress tests', () => {
    it('should handle rapid message bursts (100 messages)', async () => {
      const messages = Array.from({ length: 100 }, (_, i) =>
        createMockResponse(`req-${i}`, `vessel-${i}`, `action-${i}`),
      );

      messages.forEach((msg) => {
        processor.processMessage(msg);
      });
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
      expect(processor.store.state.instances.size).toBe(1);
      expect(processor.store.state.instances.has('vessel-99')).toBe(true);
    });

    it('should handle high-volume concurrent burst', async () => {
      const messageCount = 500;
      const messages = Array.from({ length: messageCount }, (_, i) =>
        createMockResponse(`req-${i}`, `vessel-${i}`, `action-${i}`),
      );

      messages.forEach((msg) => {
        processor.processMessage(msg);
      });
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
      expect(processor.store.state.instances.size).toBe(1);
      expect(
        processor.store.state.instances.has(`vessel-${messageCount - 1}`),
      ).toBe(true);
    });

    it('should handle burst then idle then burst pattern', async () => {
      const burst1 = Array.from({ length: 20 }, (_, i) =>
        createMockResponse(`burst1-${i}`, `vessel-b1-${i}`, `action-${i}`),
      );
      burst1.forEach((msg) => {
        processor.processMessage(msg);
      });
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);

      const burst2 = Array.from({ length: 20 }, (_, i) =>
        createMockResponse(`burst2-${i}`, `vessel-b2-${i}`, `action-${i}`),
      );
      burst2.forEach((msg) => {
        processor.processMessage(msg);
      });
      await processor.waitForIdle();

      expect(processor.store.state.status).toBe('idle');
      expect(processor.queueLength).toBe(0);
      expect(processor.store.state.instances.has('vessel-b2-19')).toBe(true);
    });
  });
});
