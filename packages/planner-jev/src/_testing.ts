/**
 * Workspace-internal subpath for tests outside this package: the
 * demo Vessel snapshot, the recorded demo turns and the scripted transports
 * planner-jev's own tests use. Importing it has no side effects and no test
 * runner import: a test that relies on a mocked `chat()` calls
 * `installMockChat(mock)` with its runner's `mock` first. Unsupported
 * for any other consumer and free to change in any release.
 */
export { conversation } from './lib/__test-helpers__/actions-fixtures.js';
export {
  type ChatCall,
  type ChatFunction,
  type ChatMocker,
  dummyAdapter,
  installMockChat,
} from './lib/__test-helpers__/chat-mock.js';
export { demoVessels } from './lib/__test-helpers__/demo-vessels.js';
export {
  makeContext,
  makeInput,
  makeRequest,
} from './lib/__test-helpers__/fixtures.js';
export {
  demoTurnPlan,
  loadDemoTurns,
  type ReplayAnswers,
  recordedAsk,
} from './lib/__test-helpers__/layout-replay.js';
export {
  DECISIONS_TEST_MODEL,
  type DecisionsScript,
  type DecisionsStep,
  scriptedDecisionsAsk,
  scriptedDecisionsFetch,
} from './lib/__test-helpers__/scripted-decisions-fetch.js';
export {
  type Payload,
  type Script,
  scriptedAsk,
  scriptedFetch,
  TEST_MODEL,
} from './lib/__test-helpers__/scripted-fetch.js';
