import type { CircuitStatus, ConnectionStatus } from './connector.types.js';

export type ConnectionManagerState = {
  connectionStatus: ConnectionStatus;
  circuitBreakerStatus: CircuitStatus;
  connectionRetryCount: number;
  connectionError: Error | null;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
};

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
