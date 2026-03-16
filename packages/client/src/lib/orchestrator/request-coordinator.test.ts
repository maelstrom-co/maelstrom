import { describe, expect, it, mock } from 'bun:test';

import type { ChartRequest } from '@maelstrom-co/protocol';

import { createMockResponse } from '../../../test-utils/mocks.js';
import type {
  ConnectorEvent,
  EngineConnector,
  Unsubscribe,
} from '../connection-manager/connector.types.js';
import type { RequestCoordinatorEvents } from './request-coordinator.js';
import { RequestCoordinator } from './request-coordinator.js';

// ============================================================================
// Test helpers
// ============================================================================

function createMockConnector(
  overrides: Partial<EngineConnector> = {},
): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    process: mock(() =>
      Promise.resolve(createMockResponse('req-1', 'instance-1', 'show')),
    ),
    subscribe: mock(
      (_handler: (event: ConnectorEvent) => void): Unsubscribe =>
        () => {},
    ),
    ...overrides,
  };
}

function createMockRequest(id = 'req-1'): ChartRequest {
  return {
    type: 'chart_request',
    id,
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'test' }],
      chartDimensions: { columns: 12, rows: 8 },
      timestamp: Date.now(),
      sessionId: 'session-1',
      layoutMode: 'tiling',
    },
    instances: [],
    vessels: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('RequestCoordinator', () => {
  describe('send', () => {
    it('should call connector.process and return response', async () => {
      const mockResponse = createMockResponse('req-1', 'instance-1', 'show');
      const connector = createMockConnector({
        process: mock(() => Promise.resolve(mockResponse)),
      });
      const coordinator = new RequestCoordinator(connector);

      const response = await coordinator.send(createMockRequest());

      expect(response).toBe(mockResponse);
      expect(connector.process).toHaveBeenCalledTimes(1);

      coordinator.dispose();
    });

    it('should set isProcessing during flight and reset after', async () => {
      let capturedIsProcessing = false;
      const connector = createMockConnector({
        process: mock(async () => {
          return createMockResponse('req-1', 'instance-1', 'show');
        }),
      });
      const coordinator = new RequestCoordinator(connector);

      coordinator.events.on('processing_started', () => {
        capturedIsProcessing = coordinator.isProcessing;
      });

      expect(coordinator.isProcessing).toBe(false);
      await coordinator.send(createMockRequest());
      expect(capturedIsProcessing).toBe(true);
      expect(coordinator.isProcessing).toBe(false);

      coordinator.dispose();
    });

    it('should emit processing_started and processing_completed events', async () => {
      const connector = createMockConnector();
      const coordinator = new RequestCoordinator(connector);
      const startedEvents: RequestCoordinatorEvents['processing_started'][] =
        [];
      const completedEvents: RequestCoordinatorEvents['processing_completed'][] =
        [];

      coordinator.events.on('processing_started', (e) => {
        startedEvents.push(e);
      });
      coordinator.events.on('processing_completed', (e) => {
        completedEvents.push(e);
      });

      await coordinator.send(createMockRequest());

      expect(startedEvents).toHaveLength(1);
      expect(startedEvents[0].requestId).toBe('req-1');

      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0].response).toBeDefined();
      expect(typeof completedEvents[0].durationMs).toBe('number');

      coordinator.dispose();
    });

    it('should emit error event on failure and re-throw', async () => {
      const connector = createMockConnector({
        process: mock(() => Promise.reject(new Error('engine down'))),
      });
      const coordinator = new RequestCoordinator(connector);
      const errors: RequestCoordinatorEvents['error'][] = [];

      coordinator.events.on('error', (e) => {
        errors.push(e);
      });

      await expect(coordinator.send(createMockRequest())).rejects.toThrow(
        'engine down',
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toBe('engine down');
      expect(coordinator.isProcessing).toBe(false);

      coordinator.dispose();
    });

    it('should update lastResponse on success', async () => {
      const mockResponse = createMockResponse('req-1', 'instance-1', 'show');
      const connector = createMockConnector({
        process: mock(() => Promise.resolve(mockResponse)),
      });
      const coordinator = new RequestCoordinator(connector);

      expect(coordinator.lastResponse).toBeNull();
      await coordinator.send(createMockRequest());
      expect(coordinator.lastResponse).toBe(mockResponse);

      coordinator.dispose();
    });
  });

  describe('flush promises', () => {
    it('should resolve queued flush promises when resolveFlushPromises is called', async () => {
      const connector = createMockConnector();
      const coordinator = new RequestCoordinator(connector);

      const flushPromise = coordinator.queueFlush();

      const mockResponse = createMockResponse('req-1', 'instance-1', 'show');
      coordinator.resolveFlushPromises(mockResponse);

      const result = await flushPromise;
      expect(result).toBe(mockResponse);

      coordinator.dispose();
    });

    it('should resolve multiple queued flush promises', async () => {
      const connector = createMockConnector();
      const coordinator = new RequestCoordinator(connector);

      const flush1 = coordinator.queueFlush();
      const flush2 = coordinator.queueFlush();

      const mockResponse = createMockResponse('req-1', 'instance-1', 'show');
      coordinator.resolveFlushPromises(mockResponse);

      const [r1, r2] = await Promise.all([flush1, flush2]);
      expect(r1).toBe(mockResponse);
      expect(r2).toBe(mockResponse);

      coordinator.dispose();
    });
  });

  describe('dispose', () => {
    it('should reject pending flush promises on dispose', async () => {
      const connector = createMockConnector();
      const coordinator = new RequestCoordinator(connector);

      const flushPromise = coordinator.queueFlush();

      coordinator.dispose();

      await expect(flushPromise).rejects.toThrow('RequestCoordinator disposed');
    });

    it('should be idempotent', () => {
      const connector = createMockConnector();
      const coordinator = new RequestCoordinator(connector);

      coordinator.dispose();
      coordinator.dispose(); // should not throw
    });
  });

  describe('events.on', () => {
    it('should return an unsubscribe function', async () => {
      const connector = createMockConnector();
      const coordinator = new RequestCoordinator(connector);
      const events: RequestCoordinatorEvents['processing_started'][] = [];

      const unsub = coordinator.events.on('processing_started', (e) => {
        events.push(e);
      });
      await coordinator.send(createMockRequest());
      expect(events).toHaveLength(1);

      unsub();
      await coordinator.send(createMockRequest('req-2'));
      expect(events).toHaveLength(1); // no new event after unsubscribe

      coordinator.dispose();
    });
  });
});
