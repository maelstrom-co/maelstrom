import {
  AGENT_WIRE_VERSION,
  type AgentAcceptedEvent,
  type AgentDisposition,
  type AgentErrorEvent,
  type AgentEvent,
  type AgentFinishedEvent,
  type AgentInput,
  type AgentMessageEvent,
  type AgentPlaceholderEvent,
  type AgentStartedEvent,
  type AgentUiChangeEvent,
  type ChangeId,
  type MaelstromResponse,
  type MessageId,
  type RunId,
} from '@maelstrom-co/protocol';

import type {
  ConnectorEvent,
  EngineConnector,
} from '../connection-manager/connector.types.js';
import type { Unsubscribe } from '../types.js';
import { createTestConnector } from './test-connector.js';

/**
 * A scriptable connector for agent conversation tests. Events are delivered
 * synchronously and every sent input is recorded.
 */
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

/**
 * Creates a {@link MockAgentConnector}. Members not involved in the agent
 * conversation keep the inert defaults of `createTestConnector` unless
 * `overrides` replaces them. `onEvent` and `subscribe` are always the scripted
 * ones. `sendInput` always records the input and wakes `nextInput` waiters
 * first, then delegates to `overrides.sendInput` when given, so a test can make
 * the send reject or never settle. Without an override it resolves.
 */
export function createMockAgentConnector(
  overrides: Partial<EngineConnector> = {},
): MockAgentConnector {
  const inputs: AgentInput[] = [];
  const inputWaiters = new Set<(input: AgentInput) => void>();
  const agentHandlers = new Set<(event: AgentEvent) => void>();
  const connectorHandlers = new Set<(event: ConnectorEvent) => void>();

  const connector = createTestConnector({
    ...overrides,
    sendInput: (input: AgentInput) => {
      inputs.push(input);
      for (const waiter of [...inputWaiters]) waiter(input);
      return overrides.sendInput?.(input) ?? Promise.resolve();
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

/**
 * Builds an `accepted` agent event. A `null` run defaults to the `noise`
 * disposition, any other run to `agent`.
 */
export function agentAcceptedEvent(
  inputId: MessageId,
  runId: RunId | null,
  disposition: AgentDisposition = runId === null ? 'noise' : 'agent',
): AgentAcceptedEvent {
  return {
    type: 'accepted',
    version: AGENT_WIRE_VERSION,
    inputId,
    runId,
    disposition,
    ack: runId === null ? '' : 'On it',
  };
}

/** Builds a `started` agent event for the run. */
export function agentStartedEvent(runId: RunId): AgentStartedEvent {
  return { type: 'started', version: AGENT_WIRE_VERSION, runId };
}

/** Builds a `placeholder` agent event for the input. */
export function agentPlaceholderEvent(
  inputId: MessageId,
  text = 'working on it',
): AgentPlaceholderEvent {
  return { type: 'placeholder', version: AGENT_WIRE_VERSION, inputId, text };
}

/** Builds a `message` agent event carrying one reply delta of the run. */
export function agentMessageEvent(
  runId: RunId,
  delta: string,
  turnId = 'turn-1',
): AgentMessageEvent {
  return {
    type: 'message',
    version: AGENT_WIRE_VERSION,
    runId,
    turnId,
    delta,
  };
}

/**
 * Builds a `finished` agent event for a run that completed. `fields` replaces
 * any of the defaults, such as the reason of a failed run.
 */
export function agentFinishedEvent(
  runId: RunId,
  fields: Partial<Omit<AgentFinishedEvent, 'type' | 'version' | 'runId'>> = {},
): AgentFinishedEvent {
  return {
    type: 'finished',
    version: AGENT_WIRE_VERSION,
    runId,
    ok: true,
    reason: 'completed',
    reply: 'Done',
    metrics: {
      turns: 1,
      toolCalls: 0,
      elapsedMs: 5,
      inputTokens: 10,
      outputTokens: 4,
    },
    ...fields,
  };
}

/** Builds an `error` agent event with the given cause and identifiers. */
export function agentErrorEvent(
  fields: Omit<AgentErrorEvent, 'type' | 'version'>,
): AgentErrorEvent {
  return { type: 'error', version: AGENT_WIRE_VERSION, ...fields };
}

/** Builds a `ui_change` agent event that asks the client to apply `response`. */
export function agentUiChangeEvent(
  runId: RunId | null,
  changeId: ChangeId,
  response: MaelstromResponse,
): AgentUiChangeEvent {
  return {
    type: 'ui_change',
    version: AGENT_WIRE_VERSION,
    runId,
    changeId,
    response,
  };
}
