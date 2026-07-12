import { mock } from 'bun:test';
import { MessageId, type SessionId } from '@maelstrom-co/protocol';

import type {
  ConnectorEvent,
  EngineConnector,
} from '../src/lib/connection-manager/connector.types.js';
import { Orchestrator } from '../src/lib/orchestrator/orchestrator.js';
import type { OrchestratorOptions } from '../src/lib/orchestrator/orchestrator.types.js';
import type { Unsubscribe } from '../src/lib/types.js';
import { createMockResponse } from './mocks.js';

export function createMockConnector(
  overrides: Partial<EngineConnector> = {},
): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: mock((_sessionId: SessionId) => Promise.resolve()),
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

export function createTestOrchestrator(
  connector?: EngineConnector,
  options: OrchestratorOptions = {},
) {
  const conn = connector ?? createMockConnector();
  const orchestrator = new Orchestrator(conn, options);
  return { connector: conn, orchestrator };
}
