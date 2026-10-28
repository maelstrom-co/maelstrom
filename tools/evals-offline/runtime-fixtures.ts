import type { PlannerCandidate } from '../../packages/engine/src/index.js';
import { getScenario } from '../../packages/evals/src/adapters/offline-case.js';
import { plannerAdapter } from '../../packages/evals/src/adapters/planner.js';
import { stageAdapter } from '../../packages/evals/src/adapters/stage.js';
import { fakePluginWith } from '../../packages/evals/src/core/__test-helpers__/fake-planner.js';
import { resolveArms } from '../../packages/evals/src/core/arms.js';
import type { ReplaySource } from '../../packages/evals/src/core/replay.js';
import type { EvalOptions } from '../../packages/evals/src/core/run.js';
import { registerStageEval } from '../../packages/evals/src/core/stage-eval.js';
import { typesafeClientBuilder } from '../../packages/evals/src/plugins/jev/client-builder.js';
import { actionsModuleWith } from '../../packages/evals/src/plugins/jev/stages/actions.js';
import { typesafeSettings } from '../../packages/evals/src/plugins/jev/typesafe-settings.js';
import {
  conversation,
  scriptedFetch,
  TEST_MODEL,
} from '../../packages/planner-jev/src/_testing.js';
import { ok } from '../../packages/protocol/src/index.js';

type AnyTextAdapter = EvalOptions['adapter'];

export const preserve = getScenario('preserve');
const candidate = {
  userMessage: 'Unchanged',
  rationale: 'Keep synthetic layout',
  executionPlan: [],
  layout: {
    tree:
      preserve.request.layout.type === 'tiling'
        ? preserve.request.layout.tree
        : [],
    instances: preserve.request.instances,
  },
} as PlannerCandidate;
const unusedAdapter = {
  kind: 'text',
  name: 'unused',
  model: 'unused',
  chatStream: () => {
    throw new Error('No LLM allowed');
  },
} as unknown as AnyTextAdapter;
export function planner(
  replay?: ReplaySource,
  calls = { count: 0 },
  defer = false,
  selected = defer ? getScenario('generate-content') : preserve,
  messages = { userMessage: 'Unchanged', rationale: 'Keep synthetic layout' },
  judging: Pick<EvalOptions, 'judge' | 'judgeRubric'> = {},
) {
  const answer: PlannerCandidate = {
    ...candidate,
    ...messages,
    layout: {
      tree:
        selected.request.layout.type === 'tiling'
          ? selected.request.layout.tree
          : [],
      instances: selected.request.instances,
    },
  };
  const plugin = fakePluginWith({
    candidate: () => {
      calls.count++;
      return answer;
    },
    ...(defer && { deferAt: 'pick' as const }),
  });
  const arm = resolveArms([plugin], ['fake'])[0];
  return plannerAdapter({
    scenario: selected,
    arm,
    provenance: replay
      ? 'synthetic-upstream-replay/downstream-mock'
      : 'real-engine/mocked-planner',
    runtime: {
      ...judging,
      adapter: unusedAdapter,
      fallback: () => async () => ok(answer),
      ...(replay && { replay: { source: replay, through: 'select' } }),
    },
  });
}

export function stage(
  id: string,
  pending = true,
  destination = 'Studio Vortex HQ',
  pick = 'map-main/showRoute',
  judging: Pick<EvalOptions, 'judge' | 'judgeRubric'> = {},
) {
  const transport = scriptedFetch(
    conversation({
      actions: [
        {
          pick,
          params: {
            destination: pending ? 'stated_elsewhere' : { value: destination },
          },
        },
      ],
    }),
  );
  const module = actionsModuleWith({
    client: typesafeClientBuilder(
      typesafeSettings({
        apiKey: 'synthetic-test-key',
        model: TEST_MODEL,
        fetch: transport.fetch,
      }),
    ),
  });
  return {
    adapter: stageAdapter({
      ...judging,
      module: registerStageEval(module),
      scenario: getScenario(id),
      variant: 'stepwise',
      provenance: 'gold-input/real-stage/scripted-transport',
    }),
    calls: transport.calls,
  };
}
