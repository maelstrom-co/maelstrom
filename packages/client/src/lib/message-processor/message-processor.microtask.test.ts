import { beforeEach, describe, expect, it } from 'bun:test';

import { createMockResponse } from '../../../test-utils/mocks.js';
import { MessageProcessor } from './message-processor.js';

describe('MessageProcessor Microtask Timing', () => {
  let processor: MessageProcessor;

  beforeEach(() => {
    processor = new MessageProcessor({ defaultActionWaitTimeoutMs: 0 });
  });

  /**
   * When two messages are fired synchronously, the first's layout phase
   * completes before the second's processMessage call runs, because
   * applyLayout is synchronous. The first await happens at executeActions.
   */
  it('should queue second message before first message hits first await', async () => {
    const statusChecks: Array<{
      msg: string;
      status: string;
      isProcessing: boolean;
    }> = [];

    const response1 = createMockResponse('req-1', 'instance-1', 'action-1');
    const response2 = createMockResponse('req-2', 'instance-2', 'action-2');

    const originalProcessMessage = processor.processMessage.bind(processor);
    processor.processMessage = (msg: typeof response1) => {
      const status = processor.store.state.status;
      const isProcessing = status !== 'idle';
      statusChecks.push({
        msg: msg.requestId,
        status,
        isProcessing,
      });
      return originalProcessMessage(msg);
    };

    processor.processMessage(response1);
    processor.processMessage(response2);

    expect(statusChecks).toHaveLength(2);

    // msg1 saw 'idle' status (first caller)
    expect(statusChecks[0]).toEqual({
      msg: 'req-1',
      status: 'idle',
      isProcessing: false,
    });

    // msg2 saw 'processing' because msg1's entire layout phase
    // completed synchronously before the first await at executeActions
    expect(statusChecks[1]).toEqual({
      msg: 'req-2',
      status: 'processing',
      isProcessing: true,
    });

    await processor.waitForIdle();

    expect(processor.store.state.status).toBe('idle');
    expect(processor.queueLength).toBe(0);
    expect(processor.store.state.instances.has('instance-2')).toBe(true);
  });

  it('should process sequentially when awaited between calls', async () => {
    const executionOrder: string[] = [];

    const response1 = createMockResponse('req-1', 'instance-1', 'action-1');
    const response2 = createMockResponse('req-2', 'instance-2', 'action-2');

    processor.events.on('message_complete', (event) => {
      executionOrder.push(event.message.requestId);
    });

    processor.processMessage(response1);
    await processor.waitForIdle();
    processor.processMessage(response2);
    await processor.waitForIdle();

    expect(executionOrder).toEqual(['req-1', 'req-2']);
    expect(processor.store.state.status).toBe('idle');
  });

  it('should use queue for rapid-fire messages without await', async () => {
    const responses = Array.from({ length: 5 }, (_, i) =>
      createMockResponse(`req-${i}`, `instance-${i}`, `action-${i}`),
    );

    responses.forEach((msg) => {
      processor.processMessage(msg);
    });

    // First message is already in 'processing' phase
    expect(processor.store.state.status).toBe('processing');
    // Messages 2-5 should be in queue
    expect(processor.queueLength).toBe(4);

    await processor.waitForIdle();

    expect(processor.store.state.status).toBe('idle');
    expect(processor.queueLength).toBe(0);
  });
});
