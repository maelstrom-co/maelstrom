import { z } from 'zod';
import { evalCaseSchema, evalFixtureSchema } from '../core/case-schema.js';
import { plannerCaseSchema } from '../core/planner-case.js';
import { selectScenarios } from '../core/scenarios.js';
import { variantCaseSchema } from '../core/variant-case.js';
import {
  jsonRefusalLexicalDataSchema,
  jsonRefusalLexicalExpectationsSchema,
  jsonRefusalLexicalInputsSchema,
} from './assistant-json-refusal-lexical.js';
import {
  labsOptionalEnumDataSchema,
  labsOptionalEnumExpectationsSchema,
  labsOptionalEnumInputsSchema,
} from './labs-state-reset-optional-enum.js';
import {
  labsStateResetSyntheticDataSchema,
  labsStateResetSyntheticExpectationsSchema,
  labsStateResetSyntheticInputsSchema,
} from './labs-state-reset-synthetic.js';
import {
  assistantIdentityDataSchema,
  assistantIdentityExpectationsSchema,
  assistantIdentityInputsSchema,
} from './legacy-assistant-identity.js';
import {
  assistantTextDataSchema,
  assistantTextExpectationsSchema,
  assistantTextInputsSchema,
} from './legacy-assistant-text.js';
import {
  calendarWeekNavDataSchema,
  calendarWeekNavExpectationsSchema,
  calendarWeekNavInputsSchema,
} from './legacy-calendar-week-nav.js';
import {
  crossVesselDataSchema,
  crossVesselExpectationsSchema,
  crossVesselInputsSchema,
} from './legacy-cross-vessel.js';
import {
  gridNoOverlapDataSchema,
  gridNoOverlapExpectationsSchema,
  gridNoOverlapInputsSchema,
} from './legacy-grid-no-overlap.js';
import {
  historyAssistantInjectionDataSchema,
  historyAssistantInjectionExpectationsSchema,
  historyAssistantInjectionInputsSchema,
} from './legacy-history-assistant-injection.js';
import {
  labsMultiMarkerFinalDataSchema,
  labsMultiMarkerFinalExpectationsSchema,
  labsMultiMarkerFinalInputsSchema,
} from './legacy-labs-multi-marker-final.js';
import {
  labsSelectMarkerDataSchema,
  labsSelectMarkerExpectationsSchema,
  labsSelectMarkerInputsSchema,
} from './legacy-labs-select-marker.js';
import {
  labsStateResetSubsetDataSchema,
  labsStateResetSubsetExpectationsSchema,
  labsStateResetSubsetInputsSchema,
} from './legacy-labs-state-reset-subset.js';
import {
  multivesselAddDataSchema,
  multivesselAddExpectationsSchema,
  multivesselAddInputsSchema,
} from './legacy-multivessel-add-instance.js';
import {
  noDualTargetPlanDataSchema,
  noDualTargetPlanExpectationsSchema,
  noDualTargetPlanInputsSchema,
} from './legacy-no-dual-target-plan.js';
import {
  constraintDataSchema,
  constraintExpectationsSchema,
  constraintInputsSchema,
  validateResponseConstraint,
} from './legacy-response-constraint.js';
import {
  targetDisambiguationDataSchema,
  targetDisambiguationExpectationsSchema,
  targetDisambiguationInputsSchema,
} from './legacy-target-disambiguation.js';
import {
  tilingAddDataSchema,
  tilingAddExpectationsSchema,
  tilingAddInputsSchema,
} from './legacy-tiling-add-vessel.js';
import {
  tilingTreeDataSchema,
  tilingTreeExpectationsSchema,
  tilingTreeInputsSchema,
} from './legacy-tiling-tree-validity.js';
import {
  transitionDataSchema,
  transitionDestination,
  transitionExpectationsSchema,
  transitionInputsSchema,
} from './legacy-vessel-transition.js';

import {
  weatherDelayedActionDataSchema,
  weatherDelayedActionExpectationsSchema,
  weatherDelayedActionInputsSchema,
} from './legacy-weather-delayed-action.js';
import {
  weatherReuseDataSchema,
  weatherReuseExpectationsSchema,
  weatherReuseInputsSchema,
} from './legacy-weather-reuse.js';
import {
  validateWeatherTransitionChain,
  weatherTransitionChainDataSchema,
  weatherTransitionChainExpectationsSchema,
  weatherTransitionChainInputsSchema,
} from './legacy-weather-transition-chain.js';
import { scriptedCandidateDataSchema } from './scripted-candidate.js';

import {
  threeVesselAdditionDataSchema,
  threeVesselAdditionExpectationsSchema,
  threeVesselAdditionInputsSchema,
} from './three-vessel-addition.js';

import {
  weatherActionBackedDataSchema,
  weatherActionBackedExpectationsSchema,
  weatherActionBackedInputsSchema,
} from './weather-action-backed-transition.js';

const variant = z.enum(['current', 'hourly', 'weekly']);
const instanceId = z.string().regex(/^[a-z][a-z0-9-]{0,119}$/);
const oracle = (id: string) =>
  z.strictObject({ id: z.literal(id), version: z.literal(1) });
const scenarioExpectation = z.strictObject({ source: z.literal('scenario') });
const scenarioId = evalCaseSchema.shape.id;
const plannerFields = {
  surface: z.literal('planner-response'),
  oracle: oracle('scenario-response'),
  migration: z.literal('reference-backed'),
  scenarioId,
  expectations: scenarioExpectation,
};
const offlineCaseSchema = z.discriminatedUnion('profile', [
  evalCaseSchema.extend({
    profile: z.literal('weather-action-backed-transition'),
    surface: z.literal('session'),
    oracle: oracle('weather-action-backed-transition'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: weatherActionBackedInputsSchema,
    expectations: weatherActionBackedExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('three-vessel-addition'),
    surface: z.literal('session'),
    oracle: oracle('three-vessel-addition'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: threeVesselAdditionInputsSchema,
    expectations: threeVesselAdditionExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('assistant-json-refusal-lexical'),
    surface: z.literal('session'),
    oracle: oracle('assistant-json-refusal-lexical'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: jsonRefusalLexicalInputsSchema,
    expectations: jsonRefusalLexicalExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-weather-transition-chain'),
    surface: z.literal('session'),
    oracle: oracle('legacy-weather-transition-chain'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: weatherTransitionChainInputsSchema,
    expectations: weatherTransitionChainExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-history-assistant-injection'),
    surface: z.literal('session'),
    oracle: oracle('legacy-history-assistant-injection'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: historyAssistantInjectionInputsSchema,
    expectations: historyAssistantInjectionExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-assistant-identity'),
    surface: z.literal('session'),
    oracle: oracle('legacy-assistant-identity'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: assistantIdentityInputsSchema,
    expectations: assistantIdentityExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-assistant-text'),
    surface: z.literal('session'),
    oracle: oracle('legacy-assistant-text'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: assistantTextInputsSchema,
    expectations: assistantTextExpectationsSchema,
  }),
  variantCaseSchema,
  evalCaseSchema.extend({
    profile: z.literal('legacy-no-dual-target-plan'),
    surface: z.literal('session'),
    oracle: oracle('legacy-no-dual-target-plan'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: noDualTargetPlanInputsSchema,
    expectations: noDualTargetPlanExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-cross-vessel'),
    surface: z.literal('session'),
    oracle: oracle('legacy-cross-vessel'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: crossVesselInputsSchema,
    expectations: crossVesselExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-multivessel-add-instance'),
    surface: z.literal('session'),
    oracle: oracle('legacy-multivessel-add-instance'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: multivesselAddInputsSchema,
    expectations: multivesselAddExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('labs-state-reset-optional-enum'),
    surface: z.literal('session'),
    oracle: oracle('labs-state-reset-optional-enum'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: labsOptionalEnumInputsSchema,
    expectations: labsOptionalEnumExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('labs-state-reset-synthetic'),
    surface: z.literal('session'),
    oracle: oracle('labs-state-reset-synthetic'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: labsStateResetSyntheticInputsSchema,
    expectations: labsStateResetSyntheticExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-labs-state-reset-subset'),
    surface: z.literal('session'),
    oracle: oracle('legacy-labs-state-reset-subset'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: labsStateResetSubsetInputsSchema,
    expectations: labsStateResetSubsetExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-grid-no-overlap'),
    surface: z.literal('session'),
    oracle: oracle('legacy-grid-no-overlap'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: gridNoOverlapInputsSchema,
    expectations: gridNoOverlapExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-tiling-tree-validity'),
    surface: z.literal('session'),
    oracle: oracle('legacy-tiling-tree-validity'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: tilingTreeInputsSchema,
    expectations: tilingTreeExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-tiling-add-vessel'),
    surface: z.literal('session'),
    oracle: oracle('legacy-tiling-add-vessel'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: tilingAddInputsSchema,
    expectations: tilingAddExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-calendar-week-nav'),
    surface: z.literal('session'),
    oracle: oracle('legacy-calendar-week-nav'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: calendarWeekNavInputsSchema,
    expectations: calendarWeekNavExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-weather-delayed-action'),
    surface: z.literal('session'),
    oracle: oracle('legacy-weather-delayed-action'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: weatherDelayedActionInputsSchema,
    expectations: weatherDelayedActionExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-target-disambiguation'),
    surface: z.literal('session'),
    oracle: oracle('legacy-target-disambiguation'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: targetDisambiguationInputsSchema,
    expectations: targetDisambiguationExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-labs-multi-marker-final'),
    surface: z.literal('session'),
    oracle: oracle('legacy-labs-multi-marker-final'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: labsMultiMarkerFinalInputsSchema,
    expectations: labsMultiMarkerFinalExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-labs-select-marker'),
    surface: z.literal('session'),
    oracle: oracle('legacy-labs-select-marker'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: labsSelectMarkerInputsSchema,
    expectations: labsSelectMarkerExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-weather-reuse'),
    surface: z.literal('session'),
    oracle: oracle('legacy-weather-reuse'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: weatherReuseInputsSchema,
    expectations: weatherReuseExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-response-constraint'),
    surface: z.literal('session'),
    oracle: oracle('legacy-response-constraint'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: constraintInputsSchema,
    expectations: constraintExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('legacy-vessel-transition'),
    surface: z.literal('session'),
    oracle: oracle('legacy-vessel-transition'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: transitionInputsSchema,
    expectations: transitionExpectationsSchema,
  }),
  evalCaseSchema.extend({
    profile: z.literal('weather-session'),
    surface: z.literal('session'),
    oracle: oracle('weather-transitions'),
    migration: z.literal('legacy-derived-harness'),
    scenarioId: z.never().optional(),
    inputs: z.strictObject({ turns: z.array(variant).min(1).max(20) }),
    expectations: z.strictObject({ variants: z.array(variant).min(1).max(20) }),
  }),
  evalCaseSchema.extend({
    profile: z.literal('client-application'),
    surface: z.literal('client-application'),
    oracle: oracle('client-effects'),
    migration: z.literal('composed-harness'),
    scenarioId: z.never().optional(),
    inputs: z.strictObject({ intent: z.string().trim().min(1).max(1000) }),
    expectations: z.strictObject({
      effects: z
        .array(
          z.strictObject({
            action: z.enum(['configure', 'openBreakdown']),
            variant: z.enum(['current', 'summary', 'breakdown']),
          }),
        )
        .length(2)
        .refine(
          (effects) =>
            new Set(effects.map((effect) => effect.action)).size === 2,
        ),
    }),
  }),
  plannerCaseSchema,
  evalCaseSchema.extend({
    ...plannerFields,
    profile: z.literal('planner-replay'),
    inputs: z.strictObject({
      response: z.literal('preserve'),
      replayScenarioId: scenarioId,
    }),
  }),
  evalCaseSchema.extend({
    profile: z.literal('action-stage'),
    surface: z.literal('isolated-stage'),
    oracle: oracle('stage-judgement'),
    migration: z.literal('reference-backed'),
    scenarioId,
    inputs: z.strictObject({
      destination: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('completion') }),
        z.strictObject({
          kind: z.literal('literal'),
          value: z.string().trim().min(1).max(200),
        }),
      ]),
    }),
    expectations: scenarioExpectation,
  }),
]);

export type OfflineCase = z.infer<typeof offlineCaseSchema>;
export type Fixture = z.infer<typeof evalFixtureSchema>;
export interface LoadedCase {
  readonly definition: OfflineCase;
  readonly fixture: Fixture;
  readonly caseDigest: string;
  readonly fixtureDigest: string;
}
export const weatherData = z.strictObject({
  instanceId,
  initialVariant: variant,
});
export const clientData = z
  .strictObject({ reportInstanceId: instanceId, createdInstanceId: instanceId })
  .refine((data) => data.reportInstanceId !== data.createdInstanceId);
export const plannerData = z.strictObject({
  userMessage: z.string().min(1).max(500),
  rationale: z.string().min(1).max(500),
});
export const routeData = z.strictObject({
  pick: z.literal('map-main/showRoute'),
});

/** Validates both the generic envelope and the code-owned offline profile; never executes it. */
export function parseOfflineCase(input: unknown): OfflineCase {
  const definition = offlineCaseSchema.parse(input);
  const required =
    'scenarioId' in definition && definition.scenarioId
      ? [definition.scenarioId]
      : [];
  if (definition.profile === 'planner-replay')
    required.push(definition.inputs.replayScenarioId);
  for (const id of required) {
    getScenario(id);
    if (
      !definition.lineage.some(
        (source) => source.source === 'current' && source.scenarioId === id,
      )
    )
      throw new Error(`Missing current-scenario lineage: ${id}`);
  }
  if (definition.profile === 'legacy-weather-transition-chain') {
    validateWeatherTransitionChain(definition.inputs, definition.expectations);
    const pointer =
      definition.expectations.trajectory === 'hourly-weekly-current'
        ? '/items/39'
        : '/items/40';
    const source = definition.lineage[0];
    if (
      definition.lineage.length !== 1 ||
      source.source !== 'legacy' ||
      source.pointer !== pointer ||
      source.revision !== 'd6ef99aacb8ebce4d707d54fee14149daeea552d' ||
      source.path !== 'langfuse/maelstrom-eval-dataset.v1.json' ||
      source.taskId !== 'cap-maelstrom-edge-deterministic-actions' ||
      source.datasetId !== source.taskId
    )
      throw new Error(
        'Weather transition chain requires matching pinned row lineage',
      );
  }
  if (definition.profile === 'weather-action-backed-transition') {
    const source = definition.lineage[0];
    if (
      definition.lineage.length !== 1 ||
      source.source !== 'legacy' ||
      source.pointer !== '/items/38' ||
      source.revision !== 'd6ef99aacb8ebce4d707d54fee14149daeea552d' ||
      source.path !== 'langfuse/maelstrom-eval-dataset.v1.json' ||
      source.taskId !== 'cap-maelstrom-edge-deterministic-actions' ||
      source.datasetId !== source.taskId
    )
      throw new Error('D39 requires matching pinned row lineage');
  }
  if (definition.profile === 'three-vessel-addition') {
    const source = definition.lineage[0];
    if (
      definition.lineage.length !== 1 ||
      source.source !== 'legacy' ||
      source.pointer !== '/items/34' ||
      source.revision !== 'd6ef99aacb8ebce4d707d54fee14149daeea552d' ||
      source.path !== 'langfuse/maelstrom-eval-dataset.v1.json' ||
      source.taskId !== 'cap-maelstrom-multivessel-three' ||
      source.datasetId !== source.taskId
    )
      throw new Error('D35 requires matching pinned row lineage');
  }
  if (definition.profile === 'labs-state-reset-optional-enum') {
    const source = definition.lineage[0];
    if (
      definition.lineage.length !== 1 ||
      source.source !== 'legacy' ||
      source.pointer !== '/items/32' ||
      source.revision !== 'd6ef99aacb8ebce4d707d54fee14149daeea552d' ||
      source.path !== 'langfuse/maelstrom-eval-dataset.v1.json' ||
      source.taskId !== 'cap-maelstrom-multiturn-state-reset' ||
      source.datasetId !== source.taskId
    )
      throw new Error(
        'D33 optional enum slice requires matching pinned row lineage',
      );
  }
  if (
    definition.profile === 'legacy-weather-transition-chain' ||
    definition.profile === 'legacy-history-assistant-injection' ||
    definition.profile === 'legacy-assistant-identity' ||
    definition.profile === 'legacy-assistant-text' ||
    definition.profile === 'assistant-json-refusal-lexical' ||
    definition.profile === 'legacy-no-dual-target-plan' ||
    definition.profile === 'legacy-cross-vessel' ||
    definition.profile === 'legacy-multivessel-add-instance' ||
    definition.profile === 'legacy-labs-state-reset-subset' ||
    definition.profile === 'labs-state-reset-synthetic' ||
    definition.profile === 'legacy-labs-multi-marker-final' ||
    definition.profile === 'legacy-grid-no-overlap' ||
    definition.profile === 'legacy-tiling-tree-validity' ||
    definition.profile === 'legacy-tiling-add-vessel' ||
    definition.profile === 'legacy-calendar-week-nav' ||
    definition.profile === 'weather-session' ||
    definition.profile === 'legacy-weather-delayed-action' ||
    definition.profile === 'legacy-target-disambiguation' ||
    definition.profile === 'legacy-labs-select-marker' ||
    definition.profile === 'legacy-weather-reuse' ||
    definition.profile === 'legacy-response-constraint' ||
    definition.profile === 'legacy-vessel-transition' ||
    definition.profile === 'client-application'
  ) {
    if (!definition.lineage.some((source) => source.source === 'legacy'))
      throw new Error('Legacy-derived cases require legacy lineage');
  }
  return definition;
}

export function getScenario(id: string) {
  const scenario = selectScenarios('all', [id])[0];
  if (!scenario) throw new Error(`Missing scenario: ${id}`);
  return scenario;
}

function validateFixture(definition: OfflineCase, fixture: Fixture): void {
  const expected =
    definition.profile === 'legacy-assistant-identity'
      ? 'assistant-identity-script'
      : definition.profile === 'legacy-assistant-text'
        ? 'assistant-text-script'
        : definition.profile === 'legacy-no-dual-target-plan'
          ? 'no-dual-target-plan-script'
          : definition.profile === 'legacy-cross-vessel'
            ? 'cross-vessel-script'
            : definition.profile === 'legacy-multivessel-add-instance'
              ? 'multivessel-add-instance-script'
              : definition.profile === 'legacy-labs-state-reset-subset'
                ? 'labs-state-reset-subset-script'
                : definition.profile === 'legacy-labs-multi-marker-final'
                  ? 'labs-multi-marker-final-script'
                  : definition.profile === 'legacy-grid-no-overlap'
                    ? 'grid-no-overlap-script'
                    : definition.profile === 'legacy-tiling-tree-validity'
                      ? 'tiling-tree-validity-script'
                      : definition.profile === 'legacy-tiling-add-vessel'
                        ? 'tiling-add-vessel-script'
                        : definition.profile === 'legacy-calendar-week-nav'
                          ? 'calendar-week-nav-script'
                          : definition.profile ===
                              'legacy-weather-delayed-action'
                            ? 'weather-delayed-action-script'
                            : definition.profile ===
                                'legacy-target-disambiguation'
                              ? 'target-disambiguation-script'
                              : definition.profile ===
                                  'legacy-labs-select-marker'
                                ? 'labs-select-marker-script'
                                : definition.profile === 'legacy-weather-reuse'
                                  ? 'weather-reuse-script'
                                  : definition.profile ===
                                      'legacy-response-constraint'
                                    ? 'legacy-response-state'
                                    : definition.profile ===
                                        'legacy-vessel-transition'
                                      ? 'legacy-vessel-state'
                                      : definition.profile === 'weather-session'
                                        ? 'weather-state'
                                        : definition.profile ===
                                            'client-application'
                                          ? 'client-identities'
                                          : definition.profile ===
                                              'action-stage'
                                            ? 'route-script'
                                            : definition.profile ===
                                                'scripted-candidate'
                                              ? 'planner-candidate'
                                              : definition.profile ===
                                                  'legacy-history-assistant-injection'
                                                ? 'history-assistant-injection-script'
                                                : definition.profile ===
                                                    'labs-state-reset-synthetic'
                                                  ? 'labs-state-reset-synthetic-script'
                                                  : definition.profile ===
                                                      'legacy-weather-transition-chain'
                                                    ? 'weather-transition-chain-script'
                                                    : 'planner-script';
  const kind =
    definition.profile === 'weather-action-backed-transition'
      ? 'weather-action-backed-transition-script'
      : definition.profile === 'three-vessel-addition'
        ? 'three-vessel-addition-script'
        : definition.profile === 'labs-state-reset-optional-enum'
          ? 'labs-state-reset-optional-enum-script'
          : definition.profile === 'assistant-json-refusal-lexical'
            ? 'assistant-json-refusal-lexical-script'
            : expected;
  if (fixture.id !== definition.fixtureId || fixture.kind !== kind)
    throw new Error(`Incompatible fixture: ${definition.id}`);
  switch (definition.profile) {
    case 'weather-action-backed-transition':
      weatherActionBackedDataSchema.parse(fixture.data);
      break;
    case 'three-vessel-addition':
      threeVesselAdditionDataSchema.parse(fixture.data);
      break;
    case 'labs-state-reset-optional-enum':
      labsOptionalEnumDataSchema.parse(fixture.data);
      break;
    case 'assistant-json-refusal-lexical':
      jsonRefusalLexicalDataSchema.parse(fixture.data);
      break;
    case 'legacy-weather-transition-chain':
      weatherTransitionChainDataSchema.parse(fixture.data);
      break;
    case 'legacy-history-assistant-injection':
      historyAssistantInjectionDataSchema.parse(fixture.data);
      break;
    case 'legacy-assistant-identity':
      assistantIdentityDataSchema.parse(fixture.data);
      break;
    case 'legacy-assistant-text':
      assistantTextDataSchema.parse(fixture.data);
      break;
    case 'scripted-candidate':
      scriptedCandidateDataSchema.parse(fixture.data);
      break;
    case 'legacy-no-dual-target-plan':
      noDualTargetPlanDataSchema.parse(fixture.data);
      break;
    case 'legacy-cross-vessel':
      crossVesselDataSchema.parse(fixture.data);
      break;
    case 'legacy-multivessel-add-instance':
      multivesselAddDataSchema.parse(fixture.data);
      break;
    case 'labs-state-reset-synthetic':
      labsStateResetSyntheticDataSchema.parse(fixture.data);
      break;
    case 'legacy-labs-state-reset-subset':
      labsStateResetSubsetDataSchema.parse(fixture.data);
      break;
    case 'legacy-grid-no-overlap':
      gridNoOverlapDataSchema.parse(fixture.data);
      break;
    case 'legacy-tiling-tree-validity':
      tilingTreeDataSchema.parse(fixture.data);
      break;
    case 'legacy-tiling-add-vessel':
      tilingAddDataSchema.parse(fixture.data);
      break;
    case 'legacy-calendar-week-nav':
      calendarWeekNavDataSchema.parse(fixture.data);
      break;
    case 'legacy-weather-delayed-action':
      weatherDelayedActionDataSchema.parse(fixture.data);
      break;
    case 'legacy-target-disambiguation':
      targetDisambiguationDataSchema.parse(fixture.data);
      break;
    case 'legacy-labs-multi-marker-final':
      labsMultiMarkerFinalDataSchema.parse(fixture.data);
      break;
    case 'legacy-labs-select-marker':
      labsSelectMarkerDataSchema.parse(fixture.data);
      break;
    case 'legacy-weather-reuse':
      weatherReuseDataSchema.parse(fixture.data);
      break;
    case 'legacy-response-constraint':
      validateResponseConstraint(
        constraintDataSchema.parse(fixture.data),
        definition.expectations,
      );
      break;
    case 'legacy-vessel-transition':
      transitionDestination(
        transitionDataSchema.parse(fixture.data),
        definition.inputs,
      );
      break;
    case 'weather-session':
      weatherData.parse(fixture.data);
      break;
    case 'client-application':
      clientData.parse(fixture.data);
      break;
    case 'action-stage':
      routeData.parse(fixture.data);
      break;
    default:
      plannerData.parse(fixture.data);
  }
}

/** Validates injected documents too, so test mutations cannot bypass profile/reference checks. */
export function validateLoadedCase(value: LoadedCase): LoadedCase {
  const definition = parseOfflineCase(value.definition);
  const fixture = evalFixtureSchema.parse(value.fixture);
  validateFixture(definition, fixture);
  return { ...value, definition, fixture };
}
