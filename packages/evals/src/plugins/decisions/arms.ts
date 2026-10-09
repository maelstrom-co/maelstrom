import {
  buildComposedPairsScreenScopePlanner,
  buildJevComposedPairsPlanner,
  buildJevPlanner,
  buildPocScreenScopePlanner,
  createStageDeps,
  type JevCall,
  type JevDeps,
} from '@maelstrom-co/planner-jev/_internal';
import type { ArmDeps } from '../../core/plugin.js';
import type { JevArm } from '../jev/arms.js';
import type { ClientBuilder } from '../jev/client-builder.js';

/**
 * The Decisions twins of `jev-poc` and the composed pairs Jev arm, on
 * `client`, and `decisions-poc-prose`, the POC on `proseClient`, whose
 * select state reads as prose rather than JSON, and
 * `decisions-poc-screen-scope-prose`, that POC with the screen scope select
 * and the spelled-out `needsActions` gate, and
 * `decisions-composed-pairs-screen-scope-prose`, the composed pairs planner
 * with the same select and fraction questions Decisions does not refuse. Each reads the replay
 * shape of its twin, so a Jev run's stages replay into it.
 */
export function decisionsArms(
  client: ClientBuilder,
  proseClient: ClientBuilder,
): readonly JevArm[] {
  const requiredEnv = [...new Set(['OPENAI_API_KEY', ...client.requiredEnv])];
  return [
    {
      name: 'decisions-poc',
      kind: 'decisions-poc',
      requiredEnv,
      replayShape: 'poc',
      build: (deps) => buildJevPlanner(stageDeps(client, deps)),
    },
    {
      name: 'decisions-composed-pairs',
      kind: 'decisions',
      requiredEnv,
      replayShape: 'gated',
      build: (deps) => buildJevComposedPairsPlanner(stageDeps(client, deps)),
    },
    {
      name: 'decisions-poc-prose',
      kind: 'decisions-poc',
      requiredEnv,
      replayShape: 'poc',
      build: (deps) => buildJevPlanner(stageDeps(proseClient, deps)),
    },
    {
      name: 'decisions-poc-screen-scope-prose',
      kind: 'decisions-poc',
      requiredEnv,
      replayShape: 'poc',
      build: (deps) =>
        buildPocScreenScopePlanner(stageDeps(proseClient, deps), {
          spelledOutActionsGate: true,
        }),
    },
    {
      name: 'decisions-composed-pairs-screen-scope-prose',
      kind: 'decisions',
      requiredEnv,
      replayShape: 'gated',
      build: (deps) =>
        buildComposedPairsScreenScopePlanner(stageDeps(proseClient, deps), {
          spelledOutActionsGate: true,
          answerableFractions: true,
        }),
    },
  ];
}

function stageDeps(client: ClientBuilder, deps: ArmDeps<JevCall>): JevDeps {
  return createStageDeps(
    client.ask(deps.onCall),
    { adapter: deps.adapter('complete'), fallback: deps.fallback },
    'StageDepsOptions',
  );
}
