import {
  scoreThreeVesselAddition,
  type ThreeVesselAdditionData,
  type ThreeVesselAdditionExpectations,
  type ThreeVesselAdditionInputs,
  threeVesselAdditionDataSchema,
  threeVesselAdditionExpectationsSchema,
  threeVesselAdditionInputsSchema,
} from '../../packages/evals/src/adapters/three-vessel-addition.js';
import { sessionAdapter } from '../../packages/evals/src/core/runtime/session.js';

/** Copies independent scripted observations through the shared lifecycle; no Engine or handlers execute. */
export function threeVesselAddition(
  fixture: ThreeVesselAdditionData,
  requests: ThreeVesselAdditionInputs,
  expectations: ThreeVesselAdditionExpectations,
) {
  const data = threeVesselAdditionDataSchema.parse(fixture);
  const inputs = threeVesselAdditionInputsSchema.parse(requests);
  const expected = threeVesselAdditionExpectationsSchema.parse(expectations);
  return sessionAdapter({
    provenance:
      'synthetic D35 user-adjudicated Weather-only addition flow; COMPLETE only for the adjudicated current contract, not legacy scorer/runtime equivalence, semantic acceptance, reliability, clinical data/trend fulfillment or handler effects',
    inputs: inputs.turns,
    initialize: () => structuredClone(data.initial),
    async step(_input, _state, history) {
      const response = structuredClone(data.responses[history.length]);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) =>
      scoreThreeVesselAddition(
        turns,
        data.initial,
        data.catalog,
        inputs,
        expected,
      ),
  });
}
