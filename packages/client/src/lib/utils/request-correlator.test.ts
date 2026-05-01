import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { MessageId, type MaelstromResponse } from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import { RequestCorrelator } from './request-correlator.js';

function createMockResponse(id: string, message: string): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: MessageId(id),
    userMessage: message,
    rationale: 'test',
    executionPlan: [],
    layout: { type: 'grid', positions: [] },
  };
}

describe('RequestCorrelator', () => {
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    clock.uninstall();
  });

  describe('create', () => {
    it('should create a pending request and return a promise', () => {
      const correlator = new RequestCorrelator();

      const promise = correlator.create(MessageId('req-1'), 1000);

      expect(correlator.pendingCount).toBe(1);
      expect(correlator.has(MessageId('req-1'))).toBe(true);
      expect(promise).toBeInstanceOf(Promise);
    });

    it('should resolve when response arrives', async () => {
      const correlator = new RequestCorrelator();
      const expectedResponse = createMockResponse('req-1', 'test');

      let resolved = false;
      let result: MaelstromResponse | undefined;

      correlator.create(MessageId('req-1'), 1000).then((res) => {
        resolved = true;
        result = res;
        return res;
      });

      // Response arrives after 10ms
      clock.setTimeout(() => {
        correlator.resolve(MessageId('req-1'), expectedResponse);
      }, 10);

      await clock.tickAsync(10);

      expect(resolved).toBe(true);
      expect(result).toEqual(expectedResponse);
      expect(correlator.pendingCount).toBe(0);
    });

    it('should reject on timeout', async () => {
      const correlator = new RequestCorrelator();

      let rejected = false;
      let errorMessage: string | undefined;

      correlator.create(MessageId('req-1'), 100).then(
        () => {},
        (err: Error) => {
          rejected = true;
          errorMessage = err.message;
        },
      );

      await clock.tickAsync(100);

      expect(rejected).toBe(true);
      expect(errorMessage).toBe('Request req-1 timed out after 100ms');
      expect(correlator.pendingCount).toBe(0);
    });
  });

  describe('resolve', () => {
    it('should resolve pending request and return true', () => {
      const correlator = new RequestCorrelator();
      const response = createMockResponse('req-1', 'test');

      correlator.create(MessageId('req-1'), 1000);
      const result = correlator.resolve(MessageId('req-1'), response);

      expect(result).toBe(true);
      expect(correlator.pendingCount).toBe(0);
    });

    it('should return false for unknown request ID', () => {
      const correlator = new RequestCorrelator();
      const response = createMockResponse('unknown', 'test');

      const result = correlator.resolve(MessageId('unknown'), response);

      expect(result).toBe(false);
    });

    it('should clear timeout when resolving', async () => {
      const correlator = new RequestCorrelator();
      const response = createMockResponse('req-1', 'test');

      let resolved = false;
      let result: MaelstromResponse | undefined;

      correlator.create(MessageId('req-1'), 50).then((res) => {
        resolved = true;
        result = res;
        return res;
      });

      // Resolve immediately (before timeout)
      correlator.resolve(MessageId('req-1'), response);

      // Wait past when timeout would have occurred
      await clock.tickAsync(100);

      expect(resolved).toBe(true);
      expect(result).toEqual(response);
    });
  });

  describe('reject', () => {
    it('should reject pending request and return true', async () => {
      const correlator = new RequestCorrelator();
      const error = new Error('Connection lost');

      // Create promise but catch the rejection so it doesn't fail the test
      const promise = correlator.create(MessageId('req-1'), 1000);
      promise.catch(() => {}); // Suppress unhandled rejection

      const result = correlator.reject(MessageId('req-1'), error);

      expect(result).toBe(true);
      expect(correlator.pendingCount).toBe(0);
    });

    it('should return false for unknown request ID', () => {
      const correlator = new RequestCorrelator();
      const error = new Error('Connection lost');

      const result = correlator.reject(MessageId('unknown'), error);

      expect(result).toBe(false);
    });

    it('should make promise reject with error', async () => {
      const correlator = new RequestCorrelator();
      const testError = new Error('Test error');

      let rejected = false;
      let errorMessage: string | undefined;

      correlator.create(MessageId('req-1'), 1000).then(
        () => {},
        (err: Error) => {
          rejected = true;
          errorMessage = err.message;
        },
      );

      correlator.reject(MessageId('req-1'), testError);

      // Allow microtasks to run
      await clock.tickAsync(0);

      expect(rejected).toBe(true);
      expect(errorMessage).toBe('Test error');
    });
  });

  describe('rejectAll', () => {
    it('should reject all pending requests', async () => {
      const correlator = new RequestCorrelator();
      const error = new Error('Connection closed');

      let rejectCount = 0;

      correlator.create(MessageId('req-1'), 1000).then(
        () => {},
        () => {
          rejectCount++;
        },
      );
      correlator.create(MessageId('req-2'), 1000).then(
        () => {},
        () => {
          rejectCount++;
        },
      );
      correlator.create(MessageId('req-3'), 1000).then(
        () => {},
        () => {
          rejectCount++;
        },
      );

      correlator.rejectAll(error);

      // Allow microtasks to run
      await clock.tickAsync(0);

      expect(correlator.pendingCount).toBe(0);
      expect(rejectCount).toBe(3);
    });

    it('should handle empty pending list', () => {
      const correlator = new RequestCorrelator();
      const error = new Error('Connection closed');

      // Should not throw
      correlator.rejectAll(error);

      expect(correlator.pendingCount).toBe(0);
    });

    it('should clear all timeouts', async () => {
      const correlator = new RequestCorrelator();
      const error = new Error('Connection closed');

      let rejectCount = 0;

      // Create multiple requests with short timeouts
      correlator.create(MessageId('req-1'), 50).then(
        () => {},
        () => {
          rejectCount++;
        },
      );
      correlator.create(MessageId('req-2'), 50).then(
        () => {},
        () => {
          rejectCount++;
        },
      );

      // Reject all before timeout
      correlator.rejectAll(error);

      // Allow microtasks to run
      await clock.tickAsync(0);

      // Wait past original timeout
      await clock.tickAsync(100);

      // Should have been rejected by rejectAll, not by timeout
      expect(rejectCount).toBe(2);
    });
  });

  describe('has', () => {
    it('should return true for pending request', () => {
      const correlator = new RequestCorrelator();

      correlator.create(MessageId('req-1'), 1000);

      expect(correlator.has(MessageId('req-1'))).toBe(true);
    });

    it('should return false for unknown request', () => {
      const correlator = new RequestCorrelator();

      correlator.create(MessageId('req-1'), 1000);

      expect(correlator.has(MessageId('req-2'))).toBe(false);
    });

    it('should return false after request is resolved', () => {
      const correlator = new RequestCorrelator();

      correlator.create(MessageId('req-1'), 1000);
      correlator.resolve(MessageId('req-1'), createMockResponse('req-1', 'test'));

      expect(correlator.has(MessageId('req-1'))).toBe(false);
    });
  });

  describe('pendingCount', () => {
    it('should reflect number of pending requests', () => {
      const correlator = new RequestCorrelator();

      expect(correlator.pendingCount).toBe(0);

      correlator.create(MessageId('req-1'), 1000);
      expect(correlator.pendingCount).toBe(1);

      correlator.create(MessageId('req-2'), 1000);
      expect(correlator.pendingCount).toBe(2);

      correlator.resolve(MessageId('req-1'), createMockResponse('req-1', 'test'));
      expect(correlator.pendingCount).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all pending requests without resolving', () => {
      const correlator = new RequestCorrelator();

      correlator.create(MessageId('req-1'), 1000);
      correlator.create(MessageId('req-2'), 1000);

      expect(correlator.pendingCount).toBe(2);

      correlator.clear();

      expect(correlator.pendingCount).toBe(0);
    });

    it('should clear all timeouts', async () => {
      const correlator = new RequestCorrelator();

      correlator.create(MessageId('req-1'), 50);

      correlator.clear();

      // Wait past timeout
      await clock.tickAsync(100);

      // Promise should still be pending (never resolved or rejected)
      expect(correlator.pendingCount).toBe(0);
    });
  });

  describe('multiple requests', () => {
    it('should handle multiple concurrent requests independently', async () => {
      const correlator = new RequestCorrelator();

      const results: MaelstromResponse[] = [];

      correlator.create(MessageId('req-1'), 1000).then((res) => {
        results.push(res);
      });
      correlator.create(MessageId('req-2'), 1000).then((res) => {
        results.push(res);
      });
      correlator.create(MessageId('req-3'), 1000).then((res) => {
        results.push(res);
      });

      // Resolve in different order
      clock.setTimeout(() => {
        correlator.resolve(MessageId('req-2'), createMockResponse('req-2', 'response-2'));
      }, 10);

      clock.setTimeout(() => {
        correlator.resolve(MessageId('req-1'), createMockResponse('req-1', 'response-1'));
      }, 20);

      clock.setTimeout(() => {
        correlator.resolve(MessageId('req-3'), createMockResponse('req-3', 'response-3'));
      }, 30);

      await clock.tickAsync(30);

      expect(results[0].userMessage).toBe('response-2');
      expect(results[1].userMessage).toBe('response-1');
      expect(results[2].userMessage).toBe('response-3');
    });

    it('should handle mix of resolved and timed out requests', async () => {
      const correlator = new RequestCorrelator();

      let resolved = false;
      let rejected = false;
      let result: MaelstromResponse | undefined;

      // First request will resolve
      correlator.create(MessageId('req-1'), 1000).then((res) => {
        resolved = true;
        result = res;
      });

      // Second request will timeout
      correlator.create(MessageId('req-2'), 50).then(
        () => {},
        () => {
          rejected = true;
        },
      );

      // Resolve first request
      clock.setTimeout(() => {
        correlator.resolve(MessageId('req-1'), createMockResponse('req-1', 'response-1'));
      }, 10);

      await clock.tickAsync(10);
      expect(resolved).toBe(true);
      expect(result?.userMessage).toBe('response-1');

      await clock.tickAsync(50);
      expect(rejected).toBe(true);
    });
  });
});
