/**
 * Workspace-internal subpath for tests that need an `EngineConnector`: a
 * factory returning a complete connector with inert defaults. Unsupported for
 * any other consumer and free to change in any release.
 */
export { createTestConnector } from "./lib/__test-helpers__/test-connector.js";
