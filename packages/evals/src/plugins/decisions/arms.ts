import {
  buildDecisionsComposedPairsPlanner,
  buildDecisionsPlanner,
  createStageDeps,
  type JevCall,
  type JevDeps,
} from '@maelstrom-co/planner-jev/_internal';
import type { ArmDeps } from '../../core/plugin.js';
import type { JevArm } from '../jev/arms.js';
import type { ClientBuilder } from '../jev/client-builder.js';

/**
 * The Decisions twins of `jev-poc` and the composed pairs Jev arm, on
 * `client`. Each reads the replay shape of its twin, so a Jev run's stages
 * replay into it.
 */
export function decisionsArms(client: ClientBuilder): readonly JevArm[] {
  const requiredEnv = [...new Set(['OPENAI_API_KEY', ...client.requiredEnv])];
  return [
    {
      name: 'decisions-poc',
      kind: 'decisions-poc',
      requiredEnv,
      replayShape: 'poc',
      build: (deps) => buildDecisionsPlanner(stageDeps(client, deps)),
    },
    {
      name: 'decisions-composed-pairs',
      kind: 'decisions',
      requiredEnv,
      replayShape: 'gated',
      build: (deps) =>
        buildDecisionsComposedPairsPlanner(stageDeps(client, deps)),
    },
  ];
}

function stageDeps(client: ClientBuilder, deps: ArmDeps<JevCall>): JevDeps {
  return createStageDeps(
    client.ask(deps.onCall),
    { adapter: deps.adapter('complete'), fallback: deps.fallback },
    'DecisionsPlannerOptions',
  );
}
