import { jsonRefusalLexicalDataSchema } from '../../packages/evals/src/adapters/assistant-json-refusal-lexical.js';
import { labsOptionalEnumDataSchema } from '../../packages/evals/src/adapters/labs-state-reset-optional-enum.js';
import { labsStateResetSyntheticDataSchema } from '../../packages/evals/src/adapters/labs-state-reset-synthetic.js';
import { assistantIdentityDataSchema } from '../../packages/evals/src/adapters/legacy-assistant-identity.js';
import { assistantTextDataSchema } from '../../packages/evals/src/adapters/legacy-assistant-text.js';
import { calendarWeekNavDataSchema } from '../../packages/evals/src/adapters/legacy-calendar-week-nav.js';
import { crossVesselDataSchema } from '../../packages/evals/src/adapters/legacy-cross-vessel.js';
import { gridNoOverlapDataSchema } from '../../packages/evals/src/adapters/legacy-grid-no-overlap.js';
import { historyAssistantInjectionDataSchema } from '../../packages/evals/src/adapters/legacy-history-assistant-injection.js';
import { labsMultiMarkerFinalDataSchema } from '../../packages/evals/src/adapters/legacy-labs-multi-marker-final.js';
import { labsSelectMarkerDataSchema } from '../../packages/evals/src/adapters/legacy-labs-select-marker.js';
import { labsStateResetSubsetDataSchema } from '../../packages/evals/src/adapters/legacy-labs-state-reset-subset.js';
import { multivesselAddDataSchema } from '../../packages/evals/src/adapters/legacy-multivessel-add-instance.js';
import { noDualTargetPlanDataSchema } from '../../packages/evals/src/adapters/legacy-no-dual-target-plan.js';
import { constraintDataSchema } from '../../packages/evals/src/adapters/legacy-response-constraint.js';
import { targetDisambiguationDataSchema } from '../../packages/evals/src/adapters/legacy-target-disambiguation.js';
import { tilingAddDataSchema } from '../../packages/evals/src/adapters/legacy-tiling-add-vessel.js';
import { tilingTreeDataSchema } from '../../packages/evals/src/adapters/legacy-tiling-tree-validity.js';
import { transitionDataSchema } from '../../packages/evals/src/adapters/legacy-vessel-transition.js';
import { weatherDelayedActionDataSchema } from '../../packages/evals/src/adapters/legacy-weather-delayed-action.js';
import { weatherReuseDataSchema } from '../../packages/evals/src/adapters/legacy-weather-reuse.js';
import { weatherTransitionChainDataSchema } from '../../packages/evals/src/adapters/legacy-weather-transition-chain.js';
import {
  clientData,
  getScenario,
  type LoadedCase,
  plannerData,
  routeData,
  validateLoadedCase,
  weatherData,
} from '../../packages/evals/src/adapters/offline-case.js';
import { scriptedCandidateDataSchema } from '../../packages/evals/src/adapters/scripted-candidate.js';
import { threeVesselAdditionDataSchema } from '../../packages/evals/src/adapters/three-vessel-addition.js';
import { weatherActionBackedDataSchema } from '../../packages/evals/src/adapters/weather-action-backed-transition.js';
import { judgeEvidence } from '../../packages/evals/src/core/judge.js';
import { judgeNotRun } from '../../packages/evals/src/core/judge-result.js';
import { plannerScenarioFromCase } from '../../packages/evals/src/core/planner-case.js';
import type { ReplaySource } from '../../packages/evals/src/core/replay.js';
import type { EvalOptions } from '../../packages/evals/src/core/run.js';
import type { EvaluationAdapter } from '../../packages/evals/src/core/runtime/evaluate.js';
import { legacyAssistantIdentity } from './assistant-identity-fixture.js';
import { assistantJsonRefusalLexical } from './assistant-json-refusal-lexical-fixture.js';
import { legacyAssistantText } from './assistant-text-fixture.js';
import { legacyCalendarWeekNav } from './calendar-week-nav-fixture.js';
import { clientFixture } from './client-fixture.js';
import { legacyCrossVessel } from './cross-vessel-fixture.js';
import { legacyGridNoOverlap } from './grid-no-overlap-fixture.js';
import { legacyHistoryAssistantInjection } from './history-assistant-injection-fixture.js';
import { legacyLabsMultiMarkerFinal } from './labs-multi-marker-final-fixture.js';
import { legacyLabsSelectMarker } from './labs-select-marker-fixture.js';
import { labsStateResetOptionalEnum } from './labs-state-reset-optional-enum-fixture.js';
import { legacyLabsStateResetSubset } from './labs-state-reset-subset-fixture.js';
import { labsStateResetSynthetic } from './labs-state-reset-synthetic-fixture.js';
import { legacyWeather } from './legacy-fixture.js';
import { legacyMultivesselAddInstance } from './multivessel-add-instance-fixture.js';
import { legacyNoDualTargetPlan } from './no-dual-target-plan-fixture.js';
import { legacyResponseConstraint } from './response-constraint-fixture.js';
import { planner, stage } from './runtime-fixtures.js';
import { scriptedCandidate } from './scripted-candidate-fixture.js';
import { legacyTargetDisambiguation } from './target-disambiguation-fixture.js';
import { threeVesselAddition } from './three-vessel-addition-fixture.js';
import { legacyTilingAddVessel } from './tiling-add-vessel-fixture.js';
import { legacyTilingTreeValidity } from './tiling-tree-validity-fixture.js';
import { legacyVesselTransition } from './vessel-transition-fixture.js';
import { weatherActionBackedTransition } from './weather-action-backed-transition-fixture.js';
import { legacyWeatherDelayedAction } from './weather-delayed-action-fixture.js';
import { legacyWeatherReuse } from './weather-reuse-fixture.js';
import { legacyWeatherTransitionChain } from './weather-transition-chain-fixture.js';

/** Code-owned composition: no dynamic module, command, URL or scorer resolution from data. */
export function caseAdapter(
  value: LoadedCase,
  judging: Pick<EvalOptions, 'judge' | 'judgeRubric'> = {},
): EvaluationAdapter<unknown> {
  const { definition, fixture, caseDigest, fixtureDigest } =
    validateLoadedCase(value);
  let adapter: EvaluationAdapter<unknown>;
  switch (definition.profile) {
    case 'weather-action-backed-transition':
      adapter = weatherActionBackedTransition(
        weatherActionBackedDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'three-vessel-addition':
      adapter = threeVesselAddition(
        threeVesselAdditionDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'labs-state-reset-optional-enum':
      adapter = labsStateResetOptionalEnum(
        labsOptionalEnumDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'assistant-json-refusal-lexical':
      adapter = assistantJsonRefusalLexical(
        jsonRefusalLexicalDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-weather-transition-chain':
      adapter = legacyWeatherTransitionChain(
        weatherTransitionChainDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-history-assistant-injection':
      adapter = legacyHistoryAssistantInjection(
        historyAssistantInjectionDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-assistant-identity':
      adapter = legacyAssistantIdentity(
        assistantIdentityDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-assistant-text':
      adapter = legacyAssistantText(
        assistantTextDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'scripted-candidate':
      adapter = scriptedCandidate(
        scriptedCandidateDataSchema.parse(fixture.data),
        definition,
        judging,
      );
      break;
    case 'legacy-no-dual-target-plan':
      adapter = legacyNoDualTargetPlan(
        noDualTargetPlanDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-cross-vessel':
      adapter = legacyCrossVessel(
        crossVesselDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-multivessel-add-instance':
      adapter = legacyMultivesselAddInstance(
        multivesselAddDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'labs-state-reset-synthetic':
      adapter = labsStateResetSynthetic(
        labsStateResetSyntheticDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-labs-state-reset-subset':
      adapter = legacyLabsStateResetSubset(
        labsStateResetSubsetDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-grid-no-overlap':
      adapter = legacyGridNoOverlap(
        gridNoOverlapDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-tiling-tree-validity':
      adapter = legacyTilingTreeValidity(
        tilingTreeDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-tiling-add-vessel':
      adapter = legacyTilingAddVessel(
        tilingAddDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-calendar-week-nav':
      adapter = legacyCalendarWeekNav(
        calendarWeekNavDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-weather-delayed-action':
      adapter = legacyWeatherDelayedAction(
        weatherDelayedActionDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-target-disambiguation':
      adapter = legacyTargetDisambiguation(
        targetDisambiguationDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-labs-multi-marker-final':
      adapter = legacyLabsMultiMarkerFinal(
        labsMultiMarkerFinalDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-labs-select-marker':
      adapter = legacyLabsSelectMarker(
        labsSelectMarkerDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-weather-reuse':
      adapter = legacyWeatherReuse(
        weatherReuseDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-response-constraint':
      adapter = legacyResponseConstraint(
        constraintDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'legacy-vessel-transition':
      adapter = legacyVesselTransition(
        transitionDataSchema.parse(fixture.data),
        definition.inputs,
        definition.expectations,
      );
      break;
    case 'weather-session': {
      const data = weatherData.parse(fixture.data);
      adapter = legacyWeather(definition.inputs.turns, {
        id: data.instanceId,
        initialVariant: data.initialVariant,
        expected: definition.expectations.variants,
      });
      break;
    }
    case 'client-application': {
      const data = clientData.parse(fixture.data);
      adapter = clientFixture(undefined, {
        ...data,
        ...definition.inputs,
        effects: definition.expectations.effects,
      });
      break;
    }
    case 'action-stage': {
      const data = routeData.parse(fixture.data);
      const binding = definition.inputs.destination;
      adapter = stage(
        definition.scenarioId,
        binding.kind === 'completion',
        binding.kind === 'literal' ? binding.value : undefined,
        data.pick,
        judging,
      ).adapter;
      break;
    }
    case 'planner':
      adapter = planner(
        undefined,
        { count: 0 },
        definition.inputs.response === 'defer',
        plannerScenarioFromCase(definition),
        plannerData.parse(fixture.data),
        judging,
      );
      break;
    case 'planner-replay': {
      const sourceScenario = getScenario(definition.inputs.replayScenarioId);
      const input = {
        request: sourceScenario.request,
        history: sourceScenario.history ?? [],
      };
      const source: ReplaySource = {
        dir: 'synthetic-memory',
        turn: () => ({
          key: `${definition.scenarioId} #1`,
          stages: [
            {
              stage: 'pick',
              ms: 1,
              outcome: 'ok',
              input,
              output: {
                input,
                picked: sourceScenario.request.instances.map(
                  (instance) => instance.instanceId,
                ),
              },
            },
          ],
        }),
      };
      adapter = planner(
        source,
        { count: 0 },
        false,
        getScenario(definition.scenarioId),
        plannerData.parse(fixture.data),
        judging,
      );
      break;
    }
  }
  const judge = judging.judge;
  return {
    ...adapter,
    ...(judge &&
      !adapter.judge && {
        async judge(result) {
          const turns = result.records
            .filter((record) => record.kind === 'turn')
            .map((record) => record.value);
          const observation =
            result.observation ?? (turns.length ? turns : undefined);
          if (
            observation === undefined ||
            result.disposition === 'not_applicable'
          )
            return judgeNotRun('no_valid_evidence');
          const last = Array.isArray(observation)
            ? observation.at(-1)?.output
            : observation;
          const assistantText =
            typeof last?.assistantText === 'string'
              ? last.assistantText
              : typeof last?.userMessage === 'string'
                ? last.userMessage
                : undefined;
          const expected = definition.expectations as Record<string, unknown>;
          const expectedText =
            typeof expected.exactText === 'string'
              ? expected.exactText
              : expected.exact_text;
          return judgeEvidence(
            judge,
            judging.judgeRubric === 'legacy'
              ? 'legacy_task'
              : definition.surface === 'session'
                ? 'session_outcome'
                : 'client_application',
            {
              profile: definition.profile,
              inputs: definition.inputs,
              expectations: definition.expectations,
              completeness: result.completeness,
              observation,
              ...(assistantText !== undefined && { assistantText }),
              ...(typeof expectedText === 'string' && { expectedText }),
            },
            { logger: { debug() {}, info() {}, warn() {}, error() {} } },
          );
        },
      }),
    provenance: `${adapter.provenance}; case-sha256:${caseDigest}; fixture-sha256:${fixtureDigest}`,
  };
}
