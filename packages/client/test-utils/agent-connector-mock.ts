import type { AgentEvent, AgentInput } from '@maelstrom-co/protocol';

import type {
  ConnectorEvent,
  EngineConnector,
} from '../src/lib/connection-manager/connector.types.js';
import type { Unsubscribe } from '../src/lib/types.js';
import { createMockConnector } from './connector-mocks.js';

export interface MockAgentConnector {
  /** The connector to pass to an Orchestrator. */
  connector: EngineConnector;
  /** Every input passed to `sendInput`, in call order. */
  inputs: AgentInput[];
  /** Delivers a scripted event to every `onEvent` handler. */
  emit(event: AgentEvent): void;
  /** Fires a `disconnected` connector event to every `subscribe` handler. */
  close(options: { clean: boolean }): void;
  /**
   * Resolves with the next input of the given type sent after this call.
   * Inputs already recorded are ignored.
   */
  nextInput<T extends AgentInput['type']>(
    type: T,
  ): Promise<Extract<AgentInput, { type: T }>>;
}

export function createMockAgentConnector(): MockAgentConnector {
  const inputs: AgentInput[] = [];
  const inputWaiters = new Set<(input: AgentInput) => void>();
  const agentHandlers = new Set<(event: AgentEvent) => void>();
  const connectorHandlers = new Set<(event: ConnectorEvent) => void>();

  const connector = createMockConnector({
    sendInput: (input: AgentInput) => {
      inputs.push(input);
      for (const waiter of [...inputWaiters]) waiter(input);
      return Promise.resolve();
    },
    onEvent: (handler: (event: AgentEvent) => void): Unsubscribe => {
      agentHandlers.add(handler);
      return () => {
        agentHandlers.delete(handler);
      };
    },
    subscribe: (handler: (event: ConnectorEvent) => void): Unsubscribe => {
      connectorHandlers.add(handler);
      return () => {
        connectorHandlers.delete(handler);
      };
    },
  });

  return {
    connector,
    inputs,
    emit(event) {
      for (const handler of [...agentHandlers]) handler(event);
    },
    close({ clean }) {
      for (const handler of [...connectorHandlers]) {
        handler({
          type: 'disconnected',
          clean,
          message: clean ? 'closed' : 'connection lost',
        });
      }
    },
    nextInput<T extends AgentInput['type']>(type: T) {
      return new Promise<Extract<AgentInput, { type: T }>>((resolve) => {
        const waiter = (input: AgentInput) => {
          if (input.type !== type) return;
          inputWaiters.delete(waiter);
          resolve(input as Extract<AgentInput, { type: T }>);
        };
        inputWaiters.add(waiter);
      });
    },
  };
}
