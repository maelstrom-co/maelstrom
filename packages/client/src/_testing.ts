/**
 * Workspace-internal subpath for tests that need an `EngineConnector`: a
 * factory returning a complete connector with inert defaults, and a scriptable
 * agent connector with builders for the agent events it delivers. Unsupported
 * for any other consumer and free to change in any release.
 */
export { createTestConnector } from './lib/__test-helpers__/test-connector.js';
export {
  agentAcceptedEvent,
  agentErrorEvent,
  agentFinishedEvent,
  agentMessageEvent,
  agentPlaceholderEvent,
  agentStartedEvent,
  agentUiChangeEvent,
  createMockAgentConnector,
  type MockAgentConnector,
} from './lib/__test-helpers__/agent-connector-mock.js';
