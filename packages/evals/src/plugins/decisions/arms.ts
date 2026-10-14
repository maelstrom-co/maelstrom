import {
  buildComposedPairsScreenScopePlanner,
  buildJevComposedPairsPlanner,
  buildJevPlanner,
  createStageDeps,
  type JevCall,
  type JevDeps,
  jevSelect,
  selectGated,
  selectGatedScreenScope,
} from '@maelstrom-co/planner-jev/_internal';
import type { ArmDeps } from '../../core/plugin.js';
import type { JevArm } from '../jev/arms.js';
import type { ClientBuilder } from '../jev/client-builder.js';

/**
 * The Decisions arms. Each reads the replay shape of its Jev twin, so a
 * Jev run's stages replay into it.
 *
 * - `decisions-poc` and `decisions-composed-pairs`: the twins of `jev-poc`
 *   and the composed pairs Jev arm, on `client`, with the select stages
 *   those arms were first measured with (`jevSelect` and `selectGated`).
 * - `decisions-poc-prose`: `decisions-poc` on `proseClient`, whose select
 *   state reads as prose rather than JSON.
 * - `decisions-poc-screen-scope-prose`: the POC with the screen scope
 *   select on `proseClient`, the twin of `jev-poc-screen-scope`. That
 *   select also asks the gated select's four gate questions and adds its
 *   `scope_unsupported` and `screen_content_unavailable` deferrals. It sets
 *   the spelled-out `needsActions` gate, which has no effect here, since
 *   the POC's actions and layout stages read no gate answers.
 * - `decisions-composed-pairs-screen-scope-prose`: the composed pairs
 *   planner with the screen scope select and the spelled-out `needsActions`
 *   gate on `proseClient`, whose layout fraction questions are told to
 *   answer half when no fraction is stated, which Decisions otherwise
 *   refuses. Its Jev twin is `jev-composed-pairs-screen-scope`.
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
      build: (deps) =>
        buildJevPlanner(stageDeps(client, deps), { select: jevSelect }),
    },
    {
      name: 'decisions-composed-pairs',
      kind: 'decisions',
      requiredEnv,
      replayShape: 'gated',
      build: (deps) =>
        buildJevComposedPairsPlanner(stageDeps(client, deps), {
          select: selectGated,
        }),
    },
    {
      name: 'decisions-poc-prose',
      kind: 'decisions-poc',
      requiredEnv,
      replayShape: 'poc',
      build: (deps) =>
        buildJevPlanner(stageDeps(proseClient, deps), { select: jevSelect }),
    },
    {
      name: 'decisions-poc-screen-scope-prose',
      kind: 'decisions-poc',
      requiredEnv,
      replayShape: 'poc',
      build: (deps) =>
        buildJevPlanner(stageDeps(proseClient, deps), {
          select: (ask) =>
            selectGatedScreenScope(ask, { spelledOutActionsGate: true }),
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
