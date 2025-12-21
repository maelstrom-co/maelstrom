import type { ChartRequest, MaelstromResponse } from '@maelstrom/protocol';
import type { ConnectionState, EngineConnector } from './types';

// ============================================================================
// Direct Engine Connector
// ============================================================================

/**
 * Engine interface for direct in-process calls.
 * This matches the interface exported by @maelstrom/engine.
 */
export interface Engine {
  process(request: ChartRequest): Promise<MaelstromResponse>;
}

/**
 * Creates a connector that calls an engine directly (in-process).
 * Useful for SSR, testing, or when running engine in the same process.
 */
export function createDirectConnector(engine: Engine): EngineConnector {
  return {
    async process(request: ChartRequest): Promise<MaelstromResponse> {
      return engine.process(request);
    },
  };
}

// ============================================================================
// HTTP Connector
// ============================================================================

export interface HttpConnectorOptions {
  /** Base URL of the engine HTTP endpoint */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Additional headers to include */
  headers?: Record<string, string>;
}

/**
 * Creates a connector that calls an engine via HTTP POST.
 */
export function createHttpConnector(
  options: HttpConnectorOptions,
): EngineConnector {
  const { baseUrl, timeout = 30000, headers = {} } = options;

  return {
    async process(request: ChartRequest): Promise<MaelstromResponse> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(`${baseUrl}/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        return response.json() as Promise<MaelstromResponse>;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

// ============================================================================
// WebSocket Connector
// ============================================================================

export interface WebSocketConnectorOptions {
  /** WebSocket URL */
  url: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Reconnect attempts (0 = no reconnect) */
  reconnectAttempts?: number;
  /** Reconnect delay in milliseconds */
  reconnectDelay?: number;
}

/**
 * Creates a connector that communicates via WebSocket.
 */
export function createWebSocketConnector(
  options: WebSocketConnectorOptions,
): EngineConnector {
  const {
    url,
    timeout = 30000,
    reconnectAttempts = 3,
    reconnectDelay = 1000,
  } = options;

  let ws: WebSocket | null = null;
  const stateListeners = new Set<(state: ConnectionState) => void>();
  const pendingRequests = new Map<
    string,
    {
      resolve: (response: MaelstromResponse) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  function setConnectionState(state: ConnectionState) {
    stateListeners.forEach((listener) => {
      listener(state);
    });
  }

  function handleMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'maelstrom_response' && data.requestId) {
        const pending = pendingRequests.get(data.requestId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          pendingRequests.delete(data.requestId);
          pending.resolve(data);
        }
      } else if (data.type === 'error' && data.requestId) {
        const pending = pendingRequests.get(data.requestId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          pendingRequests.delete(data.requestId);
          pending.reject(new Error(data.message || 'Engine error'));
        }
      }
    } catch {
      console.error(
        '[Maelstrom WebSocket] Failed to parse message:',
        event.data,
      );
    }
  }

  async function connectWithRetry(attempts: number): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        await connect();
        return;
      } catch {
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
        }
      }
    }
    throw new Error('Failed to connect after retries');
  }

  async function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        ws = new WebSocket(url);
        setConnectionState('connecting');

        ws.onopen = () => {
          setConnectionState('connected');
          resolve();
        };

        ws.onerror = () => {
          setConnectionState('error');
          reject(new Error('WebSocket connection error'));
        };

        ws.onclose = () => {
          setConnectionState('disconnected');
          // Reject all pending requests
          pendingRequests.forEach(({ reject: rej, timeoutId }) => {
            clearTimeout(timeoutId);
            rej(new Error('WebSocket closed'));
          });
          pendingRequests.clear();
        };

        ws.onmessage = handleMessage;
      } catch (err) {
        setConnectionState('error');
        reject(err);
      }
    });
  }

  return {
    async connect() {
      await connectWithRetry(reconnectAttempts + 1);
    },

    disconnect() {
      if (ws) {
        ws.close();
        ws = null;
      }
      setConnectionState('disconnected');
    },

    onConnectionStateChange(callback: (state: ConnectionState) => void) {
      stateListeners.add(callback);
      return () => stateListeners.delete(callback);
    },

    async process(request: ChartRequest): Promise<MaelstromResponse> {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
      }

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingRequests.delete(request.id);
          reject(new Error('Request timeout'));
        }, timeout);

        pendingRequests.set(request.id, { resolve, reject, timeoutId });
        ws?.send(JSON.stringify(request));
      });
    },
  };
}

// ============================================================================
// Mock Connector (for testing)
// ============================================================================

export interface MockConnectorOptions {
  /** Custom response generator */
  generateResponse?: (request: ChartRequest) => MaelstromResponse;
  /** Simulated delay in milliseconds */
  delay?: number;
}

/**
 * Creates a mock connector for testing.
 */
export function createMockConnector(
  options: MockConnectorOptions = {},
): EngineConnector {
  const { delay = 100, generateResponse } = options;

  return {
    async process(request: ChartRequest): Promise<MaelstromResponse> {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, delay));

      if (generateResponse) {
        return generateResponse(request);
      }

      // Default mock response: no actions, keep current layout
      return {
        type: 'maelstrom_response',
        requestId: request.id,
        userMessage: '',
        rationale: 'Mock response - no actions taken',
        executionPlan: [],
        layoutDirective: request.instances.map((i) => ({
          instanceId: i.instanceId,
          position: i.position,
          size: i.size,
        })),
      };
    },
  };
}
