import type { EngineConnector } from '../connection-manager/connector.types.js';

/**
 * Builds a complete {@link EngineConnector} for tests.
 *
 * Every member has an inert default: capabilities are all false, lifecycle and
 * messaging methods resolve, subscriptions return a no-op unsubscribe and
 * `process` rejects because it has no sensible default. Pass `overrides` to
 * replace any member.
 *
 * @param overrides - Members that replace the defaults.
 * @returns A connector implementing every `EngineConnector` member.
 */
export function createTestConnector(
  overrides: Partial<EngineConnector> = {},
): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    process: () =>
      Promise.reject(new Error('createTestConnector: process was not stubbed')),
    subscribe: () => noopUnsubscribe,
    addAssistantMessage: () => Promise.resolve(),
    getHistory: () => Promise.resolve([]),
    sendAgentInput: () => Promise.resolve(),
    onAgentEvent: () => noopUnsubscribe,
    ...overrides,
  };
}

function noopUnsubscribe(): void {}
