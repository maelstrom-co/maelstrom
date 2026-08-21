import type { CircuitStatus, ConnectionStatus } from './connector.types.js';

/** Observable transport, retry, and circuit-breaker state. */
export type ConnectionManagerState = {
  /** Current engine-connection lifecycle status. */
  connectionStatus: ConnectionStatus;
  /** Current circuit-breaker phase. */
  circuitBreakerStatus: CircuitStatus;
  /** Number of retry attempts charged to the current retry budget. */
  connectionRetryCount: number;
  /** Most recent connection failure, or `null` when none is retained. */
  connectionError: Error | null;
  /** Epoch milliseconds of the latest successful connection. */
  lastConnectedAt: number | null;
  /** Epoch milliseconds of the latest disconnection. */
  lastDisconnectedAt: number | null;
};

/** Creates disconnected state with a closed circuit and an unused retry budget. */
export function createInitialConnectionManagerState(): ConnectionManagerState {
  return {
    connectionStatus: 'disconnected',
    circuitBreakerStatus: 'closed',
    connectionRetryCount: 0,
    connectionError: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
  };
}
