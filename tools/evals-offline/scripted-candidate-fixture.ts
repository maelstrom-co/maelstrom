import { plannerAdapter } from '../../packages/evals/src/adapters/planner.js';
import {
  type ScriptedCandidateData,
  scriptedCandidateDataSchema,
} from '../../packages/evals/src/adapters/scripted-candidate.js';
import { fakePluginWith } from '../../packages/evals/src/core/__test-helpers__/fake-planner.js';
import { resolveArms } from '../../packages/evals/src/core/arms.js';
import type { EvalOptions } from '../../packages/evals/src/core/run.js';
import { variantScenarioFromCase } from '../../packages/evals/src/core/variant-case.js';

/** Real Engine scoring of a JSON-backed scenario with independent candidate evidence and no model. */
export function scriptedCandidate(
  fixture: ScriptedCandidateData,
  definition: unknown,
  judging: Pick<EvalOptions, 'judge' | 'judgeRubric'> = {},
) {
  const { candidate } = scriptedCandidateDataSchema.parse(fixture);
  const plugin = fakePluginWith({
    candidate: () => structuredClone(candidate),
  });
  const adapter = plannerAdapter({
    scenario: variantScenarioFromCase(definition),
    arm: resolveArms([plugin], ['fake-baseline'])[0],
    provenance: 'real-engine/scripted-candidate/no-model; json-backed variant',
    runtime: {
      ...judging,
      adapter: {
        kind: 'text',
        name: 'forbidden',
        model: 'no-model',
        chatStream() {
          throw new Error(
            'Model calls are forbidden in scripted-candidate cases',
          );
        },
      } as unknown as EvalOptions['adapter'],
      fallback: () => async () => {
        throw new Error(
          'Fallback calls are forbidden in scripted-candidate cases',
        );
      },
    },
  });
  return {
    ...adapter,
    async execute(context: Parameters<typeof adapter.execute>[0]) {
      context.record({
        kind: 'diagnostic',
        producer: 'scripted-candidate',
        value: { candidate },
      });
      return adapter.execute(context);
    },
  };
}
