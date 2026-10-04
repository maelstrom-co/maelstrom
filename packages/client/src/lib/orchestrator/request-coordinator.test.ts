import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import {
  type ChartRequest,
  ChartRequestMessage,
  type MaelstromResponse,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';

import { createMockResponse } from '../../../test-utils/mocks.js';
import type {
  ConnectorEvent,
  EngineConnector,
} from '../connection-manager/connector.types.js';
import type { Unsubscribe } from '../types.js';
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
      Promise.resolve(
        createMockResponse(MessageId('req-1'), 'instance-1', 'show'),
      ),
    ),
    subscribe: mock(
      (_handler: (event: ConnectorEvent) => void): Unsubscribe =>
        () => {},
    ),
    addAssistantMessage: mock(() => Promise.resolve()),
    getHistory: mock(() => Promise.resolve([])),
    ...overrides,
  };
}

function createMockRequest(id = MessageId('req-1')): ChartRequestMessage {
  const request: ChartRequest = {
    type: 'chart_request',
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'test' }],
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'tiling',
    },
    instances: [],
    vessels: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  };
  return ChartRequestMessage({
    sessionId: SessionId('session-1'),
    id,
    request,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('RequestCoordinator', () => {
  afterEach(() => mock.restore());
  describe('send', () => {
    it('should call connector.process and return response', async () => {
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
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
          return createMockResponse(MessageId('req-1'), 'instance-1', 'show');
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
      expect(startedEvents[0].requestId).toBe(MessageId('req-1'));

      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0].response).toBeDefined();
      expect(typeof completedEvents[0].durationMs).toBe('number');

      coordinator.dispose();
    });

    it('should emit error event on failure and re-throw', async () => {
      const errorLog = spyOn(console, 'error').mockImplementation(() => {});
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
      expect(errorLog).toHaveBeenCalledWith(
        '[RequestCoordinator]',
        expect.stringContaining('engine down'),
      );
      expect(coordinator.isProcessing).toBe(false);

      coordinator.dispose();
    });

    it('should update lastResponse on success', async () => {
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
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

      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
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

      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
      coordinator.resolveFlushPromises(mockResponse);

      const [r1, r2] = await Promise.all([flush1, flush2]);
      expect(r1).toBe(mockResponse);
      expect(r2).toBe(mockResponse);

      coordinator.dispose();
    });

    it('should reject queued flush promises with the given error when rejectFlushPromises is called', async () => {
      const connector = createMockConnector();
      const coordinator = new RequestCoordinator(connector);

      const flushPromise = coordinator.queueFlush();
      const error = new Error('flush boom');

      coordinator.rejectFlushPromises(error);

      await expect(flushPromise).rejects.toThrow('flush boom');

      coordinator.dispose();
    });

    it('should reject multiple queued flush promises and clear them', async () => {
      const connector = createMockConnector();
      const coordinator = new RequestCoordinator(connector);

      const flush1 = coordinator.queueFlush();
      const flush2 = coordinator.queueFlush();
      const error = new Error('multi flush boom');

      coordinator.rejectFlushPromises(error);

      await expect(flush1).rejects.toThrow('multi flush boom');
      await expect(flush2).rejects.toThrow('multi flush boom');

      // Subsequent resolveFlushPromises is a no-op (queue was drained).
      // Add a fresh queued promise to confirm rejection didn't poison further use.
      const flush3 = coordinator.queueFlush();
      const mockResponse = createMockResponse(
        MessageId('req-after'),
        'instance-1',
        'show',
      );
      coordinator.resolveFlushPromises(mockResponse);
      await expect(flush3).resolves.toBe(mockResponse);

      coordinator.dispose();
    });

    it('should be a no-op when rejectFlushPromises is called on an empty queue', async () => {
      const connector = createMockConnector();
      const coordinator = new RequestCoordinator(connector);

      // No queued flushes — calling reject must not throw or mutate state.
      expect(() => {
        coordinator.rejectFlushPromises(new Error('nothing to reject'));
      }).not.toThrow();

      // A fresh flush queued after the no-op call still works normally.
      const flush = coordinator.queueFlush();
      const mockResponse = createMockResponse(
        MessageId('req-after-noop'),
        'instance-1',
        'show',
      );
      coordinator.resolveFlushPromises(mockResponse);
      await expect(flush).resolves.toBe(mockResponse);

      coordinator.dispose();
    });
  });

  describe('dispose', () => {
    it('preserves a late transport rejection without logging it as a live request failure', async () => {
      let rejectRequest!: (error: Error) => void;
      const connector = createMockConnector({
        process: mock(
          () =>
            new Promise<MaelstromResponse>((_, reject) => {
              rejectRequest = reject;
            }),
        ),
      });
      const coordinator = new RequestCoordinator(connector);
      const errorLog = spyOn(console, 'error').mockImplementation(() => {});
      const cancelled = new Error('Disconnected');
      const pending = coordinator
        .send(createMockRequest())
        .catch((error: unknown) => error);

      coordinator.dispose();
      rejectRequest(cancelled);

      expect(await pending).toBe(cancelled);
      expect(errorLog).not.toHaveBeenCalled();
      expect(coordinator.isProcessing).toBe(false);
      await expect(coordinator.send(createMockRequest())).rejects.toThrow(
        'RequestCoordinator is disposed',
      );
      expect(connector.process).toHaveBeenCalledTimes(1);
    });

    it('reports the same disconnection error while the coordinator is still live', async () => {
      const disconnected = new Error('Disconnected');
      const connector = createMockConnector({
        process: () => Promise.reject(disconnected),
      });
      const coordinator = new RequestCoordinator(connector);
      const errorLog = spyOn(console, 'error').mockImplementation(() => {});
      const reported = mock(() => {});
      coordinator.events.on('error', reported);

      await expect(coordinator.send(createMockRequest())).rejects.toBe(
        disconnected,
      );
      expect(reported).toHaveBeenCalledWith({
        error: disconnected,
        timestamp: expect.any(Number),
      });
      expect(errorLog).toHaveBeenCalledWith(
        '[RequestCoordinator]',
        expect.stringContaining('Disconnected'),
      );
      coordinator.dispose();
    });

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

  describe('brand preservation', () => {
    it('round-trips MessageId from envelope through process() to response', async () => {
      const branded = MessageId('round-trip-id');
      const connector = createMockConnector({
        process: mock((msg: ChartRequestMessage) =>
          Promise.resolve(createMockResponse(msg.id, 'instance-1', 'show')),
        ),
      });
      const coordinator = new RequestCoordinator(connector);

      const response = await coordinator.send(createMockRequest(branded));

      // Identity, not just structural equality — the same branded value passed
      // in must come back out unchanged.
      expect(response.requestId).toBe(branded);

      coordinator.dispose();
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
      await coordinator.send(createMockRequest(MessageId('req-2')));
      expect(events).toHaveLength(1); // no new event after unsubscribe

      coordinator.dispose();
    });
  });
});
